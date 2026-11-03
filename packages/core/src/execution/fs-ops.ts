import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  rmdir,
  rename,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { errnoCode as codeOf, KinoshelfError } from '../errors.js';

/** True for anything at the path, a dangling symlink included. */
export const exists = (path: string): Promise<boolean> =>
  lstat(path).then(
    () => true,
    () => false,
  );

/** Device of the nearest existing ancestor of `path` (where a new file would land). */
export async function nearestExistingDevice(path: string): Promise<number | undefined> {
  for (let current = path; ; current = dirname(current)) {
    try {
      return (await stat(current)).dev;
    } catch {
      if (dirname(current) === current) {
        return undefined;
      }
    }
  }
}

/** Creates `directory` (and parents); returns the directories that did not exist, outermost first. */
export async function ensureDirectory(directory: string): Promise<string[]> {
  const missing: string[] = [];
  for (let current = directory; ; current = dirname(current)) {
    if (await exists(current)) {
      break;
    }
    missing.unshift(current);
    if (dirname(current) === current) {
      break;
    }
  }
  try {
    await mkdir(directory, { recursive: true });
  } catch (error) {
    await removeEmptyDirectories(missing);
    throw error;
  }
  return missing;
}

/**
 * Takes back the directories an operation created when it then failed: nothing is journaled for a
 * failure, so undo would never find them. `rmdir` refuses a directory that holds anything, so
 * what someone else put there meanwhile stays. Best effort: a failure here changes nothing.
 */
export async function removeEmptyDirectories(created: readonly string[]): Promise<void> {
  for (const directory of [...created].reverse()) {
    try {
      await rmdir(directory);
    } catch {
      // Not there, or not empty: the ones above it cannot be emptier.
    }
  }
}

/** Turns a low-level error into the explicit error the user will see. */
export function describeFsError(error: unknown, path: string): KinoshelfError {
  if (error instanceof KinoshelfError) {
    return error;
  }
  const code = codeOf(error);
  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return new KinoshelfError('fs.permission-denied', { path });
    case 'ENOSPC':
      return new KinoshelfError('fs.no-space', { path });
    case 'EROFS':
      return new KinoshelfError('fs.read-only', { path });
    default:
      return new KinoshelfError('fs.error', { path, code: code ?? 'unknown' });
  }
}

const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK']);

/**
 * Makes `from` appear at `to` without ever replacing an existing file: `link` fails with
 * EEXIST where `rename` would silently overwrite. On filesystems without hardlinks it falls
 * back to a checked `rename`. Returns whether `from` still has to be removed.
 */
async function publish(from: string, to: string): Promise<'linked' | 'renamed'> {
  try {
    await link(from, to);
    return 'linked';
  } catch (error) {
    const code = codeOf(error);
    if (code === 'EEXIST') {
      throw new KinoshelfError('destination.exists', { path: to });
    }
    if (code === undefined || !LINK_UNSUPPORTED.has(code)) {
      throw error;
    }
  }
  // The one place the rule can be broken: a file created at `to` between this check and the
  // `rename` is overwritten. Closing the gap needs renameat2(RENAME_NOREPLACE), which Node does not
  // expose. Reserving `to` first (an exclusive open, then renaming over it) would leave an empty
  // file under the final name after a crash, which every retry then refuses; the gap is narrower
  // than that risk is worth, and only filesystems without hardlinks take this path.
  if (await exists(to)) {
    throw new KinoshelfError('destination.exists', { path: to });
  }
  await rename(from, to);
  return 'renamed';
}

const MAX_NAME_BYTES = 255;
const TEMPORARY_OVERHEAD_BYTES = '.'.length + '.12345678'.length + '.kinoshelf-tmp'.length;

/**
 * The hidden sibling a copy is written to before being published. The name is the only thing
 * telling these files from anyone else's, so the cleanup relies on `isTemporaryName` and the two
 * are kept side by side.
 */
export function temporaryPathFor(destination: string): string {
  // The name gains 24 bytes: a final name near the 255-byte limit is cut (on a code point) so
  // the temporary one fits too.
  let name = basename(destination);
  while (Buffer.byteLength(name) > MAX_NAME_BYTES - TEMPORARY_OVERHEAD_BYTES) {
    name = Array.from(name).slice(0, -1).join('');
  }
  return join(dirname(destination), `.${name}.${randomUUID().slice(0, 8)}.kinoshelf-tmp`);
}

/** True for a file name made by `temporaryPathFor`: dot, any name, 8 hex digits, our suffix. */
export function isTemporaryName(name: string): boolean {
  return /^\..+\.[0-9a-f]{8}\.kinoshelf-tmp$/.test(name);
}

/**
 * Copies to a hidden temporary file in the destination directory, then publishes it under its
 * final name: a player never sees a partial file.
 */
export async function copyAtomic(source: string, destination: string): Promise<void> {
  const temporary = temporaryPathFor(destination);
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    const { atime, mtime } = await stat(source);
    await utimes(temporary, atime, mtime);
    if ((await publish(temporary, destination)) === 'linked') {
      await unlink(temporary);
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/**
 * Writes `data` to a hidden temporary file in the destination directory, then publishes it
 * under its final name without ever replacing an existing file (`destination.exists` instead).
 */
export async function writeAtomic(destination: string, data: string | Uint8Array): Promise<void> {
  const temporary = temporaryPathFor(destination);
  try {
    await writeFile(temporary, data, { flag: 'wx' });
    if ((await publish(temporary, destination)) === 'linked') {
      await unlink(temporary);
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/** Hardlinks; failing explicitly, never copying instead. */
export async function hardlinkFile(source: string, destination: string): Promise<void> {
  try {
    await link(source, destination);
  } catch (error) {
    const code = codeOf(error);
    if (code === 'EEXIST') {
      throw new KinoshelfError('destination.exists', { path: destination });
    }
    if (code === 'ENOENT') {
      throw new KinoshelfError('source.missing', { path: source });
    }
    if (code === 'EXDEV') {
      throw new KinoshelfError('hardlink.cross-device', { source, destination });
    }
    if (code !== undefined && LINK_UNSUPPORTED.has(code)) {
      throw new KinoshelfError('hardlink.unsupported', { destination });
    }
    throw error;
  }
}

/**
 * Moves without overwriting. Within a volume it is a link then an unlink (atomic); across
 * volumes it is a verified copy then a delete, which is what a move means there.
 */
export async function moveFile(source: string, destination: string): Promise<void> {
  let published: 'linked' | 'renamed';
  try {
    published = await publish(source, destination);
  } catch (error) {
    if (codeOf(error) === 'ENOENT') {
      throw new KinoshelfError('source.missing', { path: source });
    }
    if (codeOf(error) !== 'EXDEV') {
      throw error;
    }
    await moveAcrossDevices(source, destination);
    return;
  }
  if (published === 'linked') {
    // Two names for one file: if the old one cannot go, the new one must, or the file would sit
    // at its destination with nothing journaled to undo it.
    await unlink(source).catch(async (error: unknown) => {
      await unlink(destination).catch(() => undefined);
      throw error;
    });
  }
}

/** A verified copy then a delete; the copy is removed again if either step fails. */
async function moveAcrossDevices(source: string, destination: string): Promise<void> {
  await copyAtomic(source, destination);
  try {
    if ((await stat(source)).size !== (await stat(destination)).size) {
      throw new KinoshelfError('move.verification-failed', { source, destination });
    }
    await unlink(source);
  } catch (error) {
    await unlink(destination).catch(() => undefined);
    throw error;
  }
}
