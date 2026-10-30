import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { KinoshelfError } from '../errors.js';
import type { ErrorInfo } from '../types/errors.js';
import type { Journal, JournalEntry } from '../types/journal.js';
import type {
  DownloadOperation,
  Operation,
  OperationResult,
  TransferOperation,
  WriteFileOperation,
} from '../types/operation.js';
import type { BatchResult, ItemResult, Plan, PlanItem } from '../types/plan.js';
import { fetchImage as defaultFetchImage, MAX_IMAGE_BYTES, type ImageFetcher } from './download.js';
import {
  copyAtomic,
  describeFsError,
  ensureDirectory,
  exists,
  hardlinkFile,
  moveFile,
  nearestExistingDevice,
  writeAtomic,
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
  /** Fetches the bytes of a `download` operation; defaults to the global `fetch` with guards. */
  readonly fetchImage?: ImageFetcher;
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

/**
 * Publishes a file Kinoshelf makes (NFO) or fetches (artwork) next to a video. The destination
 * is checked before the bytes are produced and again at publication (`link` fails on EEXIST), so
 * nothing the user has is ever replaced, and a failed fetch creates no directory.
 */
async function createFile(
  operation: WriteFileOperation | DownloadOperation,
  options: ExecuteOptions,
): Promise<Outcome> {
  const { destination } = operation;
  const taken: Outcome = {
    status: 'skipped',
    error: { code: 'destination.exists', params: { path: destination } },
  };
  if (await exists(destination)) {
    return taken;
  }
  if (options.dryRun) {
    return { status: 'done' };
  }

  let data: string | Uint8Array;
  if (operation.type === 'write-file') {
    data = operation.content;
  } else {
    try {
      data = await (options.fetchImage ?? defaultFetchImage)(operation.url);
    } catch (error) {
      return {
        status: 'failed',
        error:
          error instanceof KinoshelfError
            ? error.info
            : {
                code: 'execute.download-failed',
                params: { url: operation.url, status: 'network' },
              },
      };
    }
    if (data.length > MAX_IMAGE_BYTES) {
      return {
        status: 'failed',
        error: {
          code: 'execute.download-too-large',
          params: { url: operation.url, max: MAX_IMAGE_BYTES },
        },
      };
    }
  }

  try {
    const createdDirectories = await ensureDirectory(dirname(destination));
    await writeAtomic(destination, data);
    return { status: 'done', createdDirectories };
  } catch (error) {
    if (error instanceof KinoshelfError && error.info.code === 'destination.exists') {
      return { status: 'skipped', error: error.info };
    }
    return { status: 'failed', error: describeFsError(error, destination).info };
  }
}

function journalEntry(
  operation: Operation,
  base: { id: string; batchId: string; at: string; createdDirectories: readonly string[] },
): JournalEntry {
  switch (operation.type) {
    case 'transfer':
      return {
        ...base,
        kind: 'transfer',
        source: operation.source,
        destination: operation.destination,
        mode: operation.mode,
      };
    case 'write-file':
      return { ...base, kind: 'generated', source: '', destination: operation.destination };
    case 'download':
      return {
        ...base,
        kind: 'downloaded',
        source: operation.url,
        destination: operation.destination,
      };
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
    const isMain = operation.type === 'transfer' && operation.role === 'main';
    if (!isMain && !mainDone) {
      // A subtitle, NFO or poster without its video would be an orphan.
      outcome = { status: 'skipped', error: { code: 'main-not-done' } };
    } else if (operation.type === 'transfer') {
      outcome = await transfer(operation, dryRun);
    } else {
      // Failing or skipping here never touches `mainDone`: the video stays where it arrived.
      outcome = await createFile(operation, options);
    }

    if (isMain && outcome.status !== 'done') {
      mainDone = false;
    }
    if (outcome.status === 'done') {
      if (!dryRun) {
        options.journal.record(
          journalEntry(operation, {
            id: newId(),
            batchId,
            at: now().toISOString(),
            createdDirectories: outcome.createdDirectories ?? [],
          }),
        );
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
