import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, stat, unlink, utimes } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import type { FileIdentity, Journal, JournalEntry } from '../types/journal.js';
import {
  ensureDirectory,
  exists,
  removeEmptyDirectories,
  replaceAtomic,
  writeAtomic,
} from './fs-ops.js';

export interface ReplaceImageOptions {
  readonly journal: Journal;
  readonly batchId: string;
  /** The image's place beside the media. */
  readonly destination: string;
  readonly data: Uint8Array;
  /** Where the bytes came from (an address): journaled, so a page can tell which image is in place. */
  readonly source: string;
  /** Where a file about to be replaced is kept, so that undo can bring it back. */
  readonly backupDir: string;
}

const identityOf = async (path: string): Promise<FileIdentity> => {
  const { size, mtimeMs } = await stat(path);
  return { size, mtimeMs };
};

/**
 * Keeps the file at `destination` in `backupDir` (with its date, so a restored file is the one an
 * earlier journal entry knew) and replaces it atomically; the backup's path is what undo needs.
 * A failed replacement leaves the file as it was and no backup behind.
 */
export async function backupAndReplace(
  destination: string,
  data: Uint8Array | string,
  backupDir: string,
): Promise<string> {
  await mkdir(backupDir, { recursive: true });
  const backup = join(backupDir, `${randomUUID()}${extname(destination)}`);
  const before = await stat(destination);
  await copyFile(destination, backup);
  await utimes(backup, before.atimeMs / 1000, before.mtimeMs / 1000);
  try {
    await replaceAtomic(destination, data);
  } catch (error) {
    await unlink(backup).catch(() => undefined);
    throw error;
  }
  return backup;
}

/**
 * Puts an image at `destination` on the user's explicit request, and journals it. A file that is
 * there is copied to `backupDir` first and replaced atomically; the entry (`replaced`) knows the
 * backup, so undoing the batch restores it. With nothing there it is an ordinary new image
 * (`downloaded`, published without ever replacing). The pipeline never calls this: its rule, never
 * overwrite, is untouched.
 */
export async function replaceImage(options: ReplaceImageOptions): Promise<JournalEntry> {
  const { journal, batchId, destination, data, source, backupDir } = options;
  const base = { id: randomUUID(), batchId, source, destination, at: new Date().toISOString() };

  if (!(await exists(destination))) {
    const createdDirectories = await ensureDirectory(dirname(destination));
    try {
      await writeAtomic(destination, data);
    } catch (error) {
      await removeEmptyDirectories(createdDirectories);
      throw error;
    }
    const entry: JournalEntry = {
      ...base,
      kind: 'downloaded',
      createdDirectories,
      identity: await identityOf(destination),
    };
    journal.record(entry);
    return entry;
  }

  const backup = await backupAndReplace(destination, data, backupDir);
  const entry: JournalEntry = {
    ...base,
    kind: 'replaced',
    backup,
    createdDirectories: [],
    identity: await identityOf(destination),
  };
  journal.record(entry);
  return entry;
}
