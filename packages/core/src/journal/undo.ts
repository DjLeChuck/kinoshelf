import { readFile, rmdir, stat, unlink, utimes } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  describeFsError,
  ensureDirectory,
  exists,
  moveFile,
  replaceAtomic,
} from '../execution/fs-ops.js';
import type { ErrorCode } from '../error-codes.js';
import type { ErrorInfo } from '../types/errors.js';
import type { FileIdentity, Journal, JournalEntry } from '../types/journal.js';

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
  const skipped = (code: ErrorCode, path: string): UndoEntryResult => ({
    entry,
    status: 'skipped',
    error: { code, params: { path } },
  });

  if (!(await exists(entry.destination))) {
    return skipped('undo.destination-missing', entry.destination);
  }
  if (entry.identity && !(await isUnchanged(entry.destination, entry.identity))) {
    // Replaced or edited since (a poster of the user's own, a hand-corrected NFO): it is not what
    // Kinoshelf made any more, so neither deleting it nor moving it back is ours to do.
    return skipped('undo.destination-changed', entry.destination);
  }
  if (entry.kind === 'replaced') {
    // Ours and untouched: the image that was there before comes back (this is the one undo that
    // writes over a file, and only over the one the replacement itself made).
    if (!(await exists(entry.backup))) {
      return skipped('undo.backup-missing', entry.backup);
    }
    if (dryRun) {
      return { entry, status: 'undone' };
    }
    try {
      const kept = await stat(entry.backup);
      await replaceAtomic(entry.destination, await readFile(entry.backup));
      await utimes(entry.destination, kept.atimeMs / 1000, kept.mtimeMs / 1000);
      await unlink(entry.backup).catch(() => undefined);
      return { entry, status: 'undone' };
    } catch (error) {
      return { entry, status: 'failed', error: describeFsError(error, entry.destination).info };
    }
  }
  if (entry.kind !== 'transfer') {
    // Ours and untouched: there is no original to put back.
    if (dryRun) {
      return { entry, status: 'undone' };
    }
    try {
      await unlink(entry.destination);
      return { entry, status: 'undone' };
    } catch (error) {
      return { entry, status: 'failed', error: describeFsError(error, entry.destination).info };
    }
  }
  if (entry.mode === 'move' && (await exists(entry.source))) {
    // Something took the original place since: moving back would overwrite it.
    return skipped('undo.source-exists', entry.source);
  }
  if (
    entry.mode !== 'move' &&
    !(await originalRemains(entry.source, entry.destination, entry.mode))
  ) {
    // The download was deleted after seeding (or replaced): removing this name would lose the file.
    return skipped('undo.last-copy', entry.destination);
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

async function isUnchanged(path: string, identity: FileIdentity): Promise<boolean> {
  const now = await stat(path).catch(() => null);
  return now !== null && now.size === identity.size && now.mtimeMs === identity.mtimeMs;
}

/**
 * True while the file a copy or hardlink came from is still there: same inode for a link, same
 * size for a copy (a file put at that name since is not the original).
 */
async function originalRemains(
  source: string,
  destination: string,
  mode: 'copy' | 'hardlink',
): Promise<boolean> {
  const [original, made] = await Promise.all([
    stat(source).catch(() => null),
    stat(destination).catch(() => null),
  ]);
  if (original === null || made === null) {
    return false;
  }
  return mode === 'hardlink'
    ? original.dev === made.dev && original.ino === made.ino
    : original.size === made.size;
}

/** Removes the directories the batch created, deepest first, and only if they are empty. */
async function pruneDirectories(entries: readonly JournalEntry[]): Promise<void> {
  const directories = [...new Set(entries.flatMap((e) => e.createdDirectories))];
  for (const directory of directories.sort((a, b) => b.length - a.length)) {
    await rmdir(directory).catch(() => undefined);
  }
}

/**
 * Reverts a batch that was not undone yet, whether or not it is the last one. A move goes back
 * to where it came from; a copy or hardlink loses its new name; a generated or downloaded file
 * is deleted. They are reverted most recent first, so a video's companions go before the video
 * and the directory pruning, which comes last, finds them empty. Each entry is checked against
 * the disk as it is now, so a later batch cannot be damaged: a destination that was moved on or
 * removed since is skipped, one replaced or edited since is kept, an original place taken since
 * is skipped, a copy or link whose
 * original is gone is kept (it is the last one), and directories a later batch also filled are
 * left (only empty ones go). Nothing is forced. The batch is marked undone only when nothing
 * failed, so a failed undo can be retried; the entries it did revert are marked one by one, and
 * a retry leaves them alone. Returns `null` for an unknown or
 * already undone batch.
 */
export async function undoBatch(
  journal: Journal,
  batchId: string,
  options: {
    readonly dryRun?: boolean;
    /** Told after each entry, and once at the start with `done` 0: a big batch is long to revert. */
    readonly onProgress?: (done: number, total: number, current: string) => void;
  } = {},
): Promise<UndoResult | null> {
  const journaled = journal.entriesOf(batchId);
  if (journaled.length === 0 || journal.isUndone(batchId)) {
    return null;
  }
  const dryRun = options.dryRun ?? false;

  // What an earlier, unfinished undo already reverted stays as it is now.
  const reverted = journal.undoneEntryIds(batchId);
  const entries: UndoEntryResult[] = [];
  const pending = [...journaled].reverse().filter((entry) => !reverted.has(entry.id));
  options.onProgress?.(0, pending.length, '');
  for (const entry of pending) {
    entries.push(await revert(entry, dryRun));
    options.onProgress?.(entries.length, pending.length, entry.destination);
  }

  if (!dryRun) {
    await pruneDirectories(journaled);
    if (entries.every((e) => e.status !== 'failed')) {
      journal.markUndone(batchId);
    } else {
      journal.markUndone(
        batchId,
        entries.filter((e) => e.status === 'undone').map((e) => e.entry.id),
      );
    }
  }
  return { batchId, dryRun, entries };
}

/** Reverts the most recent batch that was not undone yet (what the CLI offers). */
export async function undoLastBatch(
  journal: Journal,
  options: { readonly dryRun?: boolean } = {},
): Promise<UndoResult | null> {
  const batchId = journal.lastBatchId();
  return batchId === null ? null : undoBatch(journal, batchId, options);
}
