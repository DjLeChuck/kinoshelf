import { lstat, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { KinoshelfError } from '../errors.js';
import { describeFsError, isTemporaryName } from '../execution/fs-ops.js';
import type { ErrorInfo } from '../types/errors.js';

const HOUR_MS = 3_600_000;

/**
 * The youngest age accepted. A copy of a large file runs for minutes, and a file still being
 * written must never be taken for an abandoned one.
 */
export const MIN_STALE_AGE_HOURS = 1;

export interface StaleFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly ageHours: number;
  /** `stale`: found, left alone (dry run). */
  readonly status: 'stale' | 'removed' | 'failed';
  readonly error?: ErrorInfo;
}

export interface CleanupOptions {
  readonly olderThanHours: number;
  /** Only report; delete nothing. */
  readonly dryRun: boolean;
  readonly now?: () => number;
}

/**
 * Finds, and unless `dryRun` removes, the temporary files a copy left behind when it was
 * interrupted (`.<name>.<8 hex>.kinoshelf-tmp`), under the given folders.
 *
 * What makes a file safe to remove:
 * - its name has the exact form Kinoshelf gives its temporaries, which nothing else produces;
 * - it is a regular file (a link is never followed or removed);
 * - its `ctime` is old. Not `mtime`: a finished copy gets the source's (old) `mtime` just before
 *   being published, so `mtime` would call a live file abandoned. `ctime` moves on every write
 *   and every `utimes` and cannot be set, so an untouched `ctime` means nobody is writing.
 *
 * The age is checked again right before each removal.
 */
export async function cleanupStaleTemporaryFiles(
  roots: readonly string[],
  options: CleanupOptions,
): Promise<StaleFile[]> {
  if (!(options.olderThanHours >= MIN_STALE_AGE_HOURS)) {
    throw new KinoshelfError('cleanup.age-too-short', { min: MIN_STALE_AGE_HOURS });
  }
  const now = options.now ?? Date.now;
  const minAgeMs = options.olderThanHours * HOUR_MS;

  const results: StaleFile[] = [];
  for (const root of roots) {
    for (const path of await findTemporaryFiles(root)) {
      const info = await staleInfo(path, minAgeMs, now());
      if (!info) {
        continue;
      }
      if (options.dryRun) {
        results.push({ path, ...info, status: 'stale' });
        continue;
      }
      try {
        // The file may have been touched since it was found: decide again on fresh data.
        if (await staleInfo(path, minAgeMs, now())) {
          await unlink(path);
          results.push({ path, ...info, status: 'removed' });
        }
      } catch (error) {
        results.push({
          path,
          ...info,
          status: 'failed',
          error: describeFsError(error, path).info,
        });
      }
    }
  }
  return results;
}

async function staleInfo(
  path: string,
  minAgeMs: number,
  now: number,
): Promise<{ sizeBytes: number; ageHours: number } | undefined> {
  const stats = await lstat(path).catch(() => undefined);
  if (!stats?.isFile() || now - stats.ctimeMs < minAgeMs) {
    return undefined;
  }
  return { sizeBytes: stats.size, ageHours: (now - stats.ctimeMs) / HOUR_MS };
}

/** Candidates by name only; real symlinks and special files are skipped by `Dirent`. */
async function findTemporaryFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    throw code === 'ENOENT' || code === 'ENOTDIR'
      ? new KinoshelfError('discover.not-found', { path: root })
      : describeFsError(error, root);
  }
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findTemporaryFiles(path)));
    } else if (entry.isFile() && isTemporaryName(entry.name)) {
      found.push(path);
    }
  }
  return found;
}
