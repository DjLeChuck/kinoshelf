import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { KinoshelfError } from '../errors.js';
import type { ErrorInfo } from '../types/errors.js';
import type { Journal } from '../types/journal.js';
import type { OperationResult, TransferOperation } from '../types/operation.js';
import type { BatchResult, ItemResult, Plan, PlanItem } from '../types/plan.js';
import {
  copyAtomic,
  describeFsError,
  ensureDirectory,
  exists,
  hardlinkFile,
  moveFile,
  nearestExistingDevice,
} from './fs-ops.js';

export interface ExecuteOptions {
  readonly journal: Journal;
  /** Checks every precondition and reports what would happen, without writing anything. */
  readonly dryRun?: boolean;
  /**
   * The id of the batch, when the caller wants to record it before the first transfer (a crash
   * then leaves a trace of which batch was running). Defaults to a fresh one.
   */
  readonly batchId?: string;
  /**
   * Called as soon as an item is done, its transfers already journaled. A caller keeping its own
   * records (the server) updates them here, so after a crash they are in step with the journal
   * except for the item in flight.
   */
  readonly onItem?: (result: ItemResult) => void;
  readonly newId?: () => string;
  readonly now?: () => Date;
}

type Outcome =
  | { readonly status: 'done'; readonly createdDirectories?: readonly string[] }
  | { readonly status: 'skipped' | 'failed'; readonly error: ErrorInfo };

/**
 * What would stop this transfer right now. Run again just before writing: the plan may be
 * old, and a destination can appear in between, which must never be overwritten.
 */
async function precondition(operation: TransferOperation): Promise<ErrorInfo | 'exists' | null> {
  if (!(await exists(operation.source))) {
    return { code: 'source.missing', params: { path: operation.source } };
  }
  if (await exists(operation.destination)) {
    return 'exists';
  }
  if (operation.mode === 'hardlink') {
    const [source, device] = await Promise.all([
      stat(operation.source),
      nearestExistingDevice(dirname(operation.destination)),
    ]);
    if (device !== undefined && device !== source.dev) {
      return {
        code: 'hardlink.cross-device',
        params: { source: operation.source, destination: operation.destination },
      };
    }
  }
  return null;
}

async function transfer(operation: TransferOperation, dryRun: boolean): Promise<Outcome> {
  const blocker = await precondition(operation);
  if (blocker === 'exists') {
    return {
      status: 'skipped',
      error: { code: 'destination.exists', params: { path: operation.destination } },
    };
  }
  if (blocker) {
    return { status: 'failed', error: blocker };
  }
  if (dryRun) {
    return { status: 'done' };
  }

  try {
    const createdDirectories = await ensureDirectory(dirname(operation.destination));
    switch (operation.mode) {
      case 'copy':
        await copyAtomic(operation.source, operation.destination);
        break;
      case 'hardlink':
        await hardlinkFile(operation.source, operation.destination);
        break;
      case 'move':
        await moveFile(operation.source, operation.destination);
        break;
    }
    return { status: 'done', createdDirectories };
  } catch (error) {
    if (error instanceof KinoshelfError && error.info.code === 'destination.exists') {
      return { status: 'skipped', error: error.info };
    }
    return { status: 'failed', error: describeFsError(error, operation.destination).info };
  }
}

async function runItem(
  item: PlanItem,
  batchId: string,
  options: ExecuteOptions,
  newId: () => string,
  now: () => Date,
): Promise<ItemResult> {
  const dryRun = options.dryRun ?? false;
  const results: OperationResult[] = [];
  let mainDone = true;

  for (const operation of item.operations) {
    let outcome: Outcome;
    if (operation.type !== 'transfer') {
      outcome = {
        status: 'failed',
        error: { code: 'operation.unsupported', params: { type: operation.type } },
      };
    } else if (operation.role === 'sidecar' && !mainDone) {
      // A subtitle without its video would be an orphan.
      outcome = { status: 'skipped', error: { code: 'main-not-done' } };
    } else {
      outcome = await transfer(operation, dryRun);
    }

    if (operation.type === 'transfer' && operation.role === 'main' && outcome.status !== 'done') {
      mainDone = false;
    }
    if (outcome.status === 'done') {
      if (!dryRun && operation.type === 'transfer') {
        options.journal.record({
          id: newId(),
          batchId,
          source: operation.source,
          destination: operation.destination,
          mode: operation.mode,
          at: now().toISOString(),
          createdDirectories: outcome.createdDirectories ?? [],
        });
      }
      results.push({ operation, status: 'done' });
    } else {
      results.push({ operation, status: outcome.status, error: outcome.error });
    }
  }
  return { itemId: item.id, results };
}

/**
 * Runs the `ready` items of a plan. Items that are `in-place` or in `conflict` are reported
 * with no result and never touched. One failing item does not stop the others. Every
 * transfer is journaled as soon as it is done, so a crash still leaves an undoable trace.
 */
export async function executePlan(plan: Plan, options: ExecuteOptions): Promise<BatchResult> {
  const newId = options.newId ?? randomUUID;
  const now = options.now ?? ((): Date => new Date());
  const batchId = options.batchId ?? newId();

  const items: ItemResult[] = [];
  for (const item of plan.items) {
    const result =
      item.status === 'ready'
        ? await runItem(item, batchId, options, newId, now)
        : { itemId: item.id, results: [] };
    items.push(result);
    options.onItem?.(result);
  }
  return { batchId, planId: plan.id, dryRun: options.dryRun ?? false, items };
}
