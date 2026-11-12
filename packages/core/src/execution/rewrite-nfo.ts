import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { Journal, JournalEntry } from '../types/journal.js';
import { backupAndReplace } from './replace.js';
import { exists } from './fs-ops.js';
import { madeByUs } from './prune.js';

/**
 * - `rewritten`: the NFO says something else now; the old one is kept, so undo brings it back.
 * - `unchanged`: it already says exactly this; nothing was touched.
 * - `kept`: a file Kinoshelf did not write, or that someone edited since (by hand, or a player's
 *   export). It is never overwritten: the owner's changes outrank the metadata.
 * - `missing`: there is no NFO to rewrite. Writing a new one is what "Refresh" does.
 */
export type RewriteNfoResult = 'rewritten' | 'unchanged' | 'kept' | 'missing';

export interface RewriteNfoOptions {
  readonly journal: Journal;
  readonly batchId: string;
  readonly destination: string;
  /** The whole NFO, generated again from the metadata. */
  readonly content: string;
  /** Where the file about to be replaced is kept, so that undo can bring it back. */
  readonly backupDir: string;
}

/**
 * Writes the NFO of a work again, on the owner's request (a collection changed). Nothing edits an
 * NFO in place: it is generated whole, so a file that is not exactly what Kinoshelf wrote is left
 * alone, as the executor does for a work matched again (`madeByUs`). The replacement is journaled
 * (`replaced`), so the batch can be undone. The pipeline never calls this: its rule, never
 * overwrite, is untouched.
 */
export async function rewriteNfo(options: RewriteNfoOptions): Promise<RewriteNfoResult> {
  const { journal, batchId, destination, content, backupDir } = options;
  if (!(await exists(destination))) {
    return 'missing';
  }
  if ((await readFile(destination, 'utf8')) === content) {
    return 'unchanged';
  }
  if (!(await madeByUs(journal, destination))) {
    return 'kept';
  }
  const backup = await backupAndReplace(destination, content, backupDir);
  const { size, mtimeMs } = await stat(destination);
  const entry: JournalEntry = {
    id: randomUUID(),
    batchId,
    kind: 'replaced',
    source: '',
    destination,
    backup,
    createdDirectories: [],
    at: new Date().toISOString(),
    identity: { size, mtimeMs },
  };
  journal.record(entry);
  return 'rewritten';
}
