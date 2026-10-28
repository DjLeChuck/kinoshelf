import { rmdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { describeFsError, ensureDirectory, exists, moveFile } from '../execution/fs-ops.js';
import type { ErrorInfo } from '../types/errors.js';
import type { Journal, JournalEntry } from '../types/journal.js';

export interface UndoEntryResult {
  readonly entry: JournalEntry;
  readonly status: 'undone' | 'skipped' | 'failed';
  readonly error?: ErrorInfo;
}

export interface UndoResult {
  readonly batchId: string;
  readonly dryRun: boolean;
  /** Most recent operation first, the order in which they are reverted. */
  readonly entries: readonly UndoEntryResult[];
}

async function revert(entry: JournalEntry, dryRun: boolean): Promise<UndoEntryResult> {
  const skipped = (code: string, path: string): UndoEntryResult => ({
    entry,
    status: 'skipped',
    error: { code, params: { path } },
  });

  if (!(await exists(entry.destination))) {
    return skipped('undo.destination-missing', entry.destination);
  }
  if (entry.mode === 'move' && (await exists(entry.source))) {
    // Something took the original place since: moving back would overwrite it.
    return skipped('undo.source-exists', entry.source);
  }
  if (dryRun) {
    return { entry, status: 'undone' };
  }

  try {
    if (entry.mode === 'move') {
      await ensureDirectory(dirname(entry.source));
      await moveFile(entry.destination, entry.source);
    } else {
      // Copy or hardlink: the source is untouched, only the new name goes away.
      await unlink(entry.destination);
    }
    return { entry, status: 'undone' };
  } catch (error) {
    return { entry, status: 'failed', error: describeFsError(error, entry.destination).info };
  }
}

/** Removes the directories the batch created, deepest first, and only if they are empty. */
async function pruneDirectories(entries: readonly JournalEntry[]): Promise<void> {
  const directories = [...new Set(entries.flatMap((e) => e.createdDirectories))];
  for (const directory of directories.sort((a, b) => b.length - a.length)) {
    await rmdir(directory).catch(() => undefined);
  }
}

/**
 * Reverts the last batch that was not undone yet. A move goes back to where it came from;
 * a copy or hardlink loses its new name. Anything that no longer matches (destination gone,
 * original place taken) is skipped and reported, never forced. The batch is marked undone
 * only when nothing failed, so a failed undo can be retried.
 */
export async function undoLastBatch(
  journal: Journal,
  options: { readonly dryRun?: boolean } = {},
): Promise<UndoResult | null> {
  const batchId = journal.lastBatchId();
  if (batchId === null) {
    return null;
  }
  const dryRun = options.dryRun ?? false;
  const journaled = journal.entriesOf(batchId);

  const entries: UndoEntryResult[] = [];
  for (const entry of [...journaled].reverse()) {
    entries.push(await revert(entry, dryRun));
  }

  if (!dryRun) {
    await pruneDirectories(journaled);
    if (entries.every((e) => e.status !== 'failed')) {
      journal.markUndone(batchId);
    }
  }
  return { batchId, dryRun, entries };
}
