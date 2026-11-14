import { randomUUID } from 'node:crypto';
import { mkdir, rmdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { describeFsError, moveFile } from '../execution/fs-ops.js';
import type { ErrorInfo } from '../types/errors.js';
import type { Journal } from '../types/journal.js';
import { readTree, tidyReport, type Folder, type TidyLibrary } from './tidy-report.js';

/** Why a folder was left alone. */
export type OrphanSkipReason =
  /** It holds something that is neither an NFO, an image nor a subtitle. */
  | 'other-files'
  /** No sibling with a video bears the same name: the folder may be the only trace of a work. */
  | 'no-twin'
  /** A video appeared, or part of it became unreadable, between the report and the move. */
  | 'changed';

export interface TidiedFolder {
  readonly path: string;
  /** The sibling folder, holding a video, that this one duplicates. */
  readonly twin?: string;
  /** The twin was found by title and year, not by name: worth a look before `--apply`. */
  readonly approximate?: true;
  /** `would-remove`: dry run. */
  readonly status: 'would-remove' | 'removed' | 'skipped' | 'failed';
  readonly reason?: OrphanSkipReason;
  readonly files: number;
  /** Holds no file at all (only empty folders): removed with no twin, as there is nothing to keep. */
  readonly empty?: true;
  /** Files already moved when it failed (they are journaled, and undo brings them back). */
  readonly moved?: number;
  readonly error?: ErrorInfo;
}

export interface TidyOrphansOptions {
  readonly journal: Journal;
  /** Where what is taken out is kept (`<config>/replaced`), so undo can bring it back. */
  readonly backupDir: string;
  readonly dryRun: boolean;
  readonly batchId?: string;
  /** Told once the tree is read (`done` 0), then after each folder: a big library is long to settle. */
  readonly onProgress?: (done: number, total: number, current: string) => void;
}

export interface TidyOrphansResult {
  /** `null` when nothing was moved. */
  readonly batchId: string | null;
  readonly folders: readonly TidiedFolder[];
}

/**
 * The name a folder is compared by to find its twin: tinyMediaManager's `Title (2020) - 1080p`
 * and Kinoshelf's `Title (2020)` are the same work, and so are `Season 1` and `Season 01`. Case,
 * accents, punctuation (the Windows profile drops a `:`), an id tag and a trailing picture size
 * are not part of the identity.
 */
export function twinKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\{[^}]*\}/g, '')
    .replace(/\s*-\s*(?:\d{3,4}p|4k|uhd)\s*$/, '')
    .replace(/\b0+(\d)/g, '$1')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** A folder name as a title and a year, both in `twinKey` form; `year` is `''` when it names none. */
function titleAndYear(name: string): { title: string; year: string } {
  const years = [...name.matchAll(/\((\d{4})\)/g)];
  const last = years[years.length - 1];
  if (last?.index === undefined) {
    return { title: twinKey(name), year: '' };
  }
  return { title: twinKey(name.slice(0, last.index)), year: last[1] ?? '' };
}

/**
 * The sibling of `path`, holding a video, that is the same work. First by name (`twinKey`); failing
 * that, `approximate`: same year, and the sibling's title opens this one's, which is what an edition
 * (`Saw II - Unrated (2005)` for `Saw II (2005)`) or a part's subtitle (`Dune - Première partie`
 * for `Dune`) does to a name. The longest such title wins, and a tie finds none: two different
 * works must never be taken for each other.
 */
function findTwin(path: string, root: Folder): { path: string; approximate: boolean } | undefined {
  const key = twinKey(basename(path));
  if (key === '') {
    return undefined;
  }
  const parent = findFolder(root, dirname(path));
  const siblings = (parent?.folders ?? []).filter(
    (sibling) => sibling.path !== path && sibling.videos > 0,
  );
  const exact = siblings.find((sibling) => twinKey(basename(sibling.path)) === key);
  if (exact) {
    return { path: exact.path, approximate: false };
  }
  const mine = titleAndYear(basename(path));
  if (mine.year === '') {
    return undefined;
  }
  const near = siblings
    .map((sibling) => ({ sibling, theirs: titleAndYear(basename(sibling.path)) }))
    .filter(
      ({ theirs }) =>
        theirs.year === mine.year && theirs.title !== '' && mine.title.startsWith(theirs.title),
    );
  const longest = Math.max(0, ...near.map(({ theirs }) => theirs.title.length));
  const best = near.filter(({ theirs }) => theirs.title.length === longest);
  return best.length === 1 && best[0]
    ? { path: best[0].sibling.path, approximate: true }
    : undefined;
}

function findFolder(folder: Folder, path: string): Folder | undefined {
  if (folder.path === path) {
    return folder;
  }
  for (const child of folder.folders) {
    if (path === child.path || path.startsWith(`${child.path}/`)) {
      return findFolder(child, path);
    }
  }
  return undefined;
}

/** Every file below a folder with its path, then the folders deepest first. */
function contentOf(folder: Folder): { files: string[]; folders: string[] } {
  const files = folder.files.toSorted().map((name) => join(folder.path, name));
  const folders = [folder.path];
  for (const child of folder.folders) {
    const inner = contentOf(child);
    files.push(...inner.files);
    folders.unshift(...inner.folders);
  }
  return { files, folders };
}

/**
 * Takes the folders `tidyReport` lists as holding no video out of a library, as one journaled batch.
 * Nothing is deleted: each file moves to `backupDir` and is journaled (`removed`), so undo puts it
 * back, its folders included.
 *
 * The report is read again here, never trusted from earlier, and a folder is moved only when:
 * - it holds nothing but NFO, images and subtitles (`otherFiles` is 0);
 * - a sibling that holds a video bears the same name (`twinKey`): the work lives on there, and this
 *   folder is what a former tool left behind. A folder with no twin may be a share not mounted, a
 *   download not started, or the only trace of a work, and is never touched;
 * - it is still without a video right before its files move.
 */
export async function removeOrphanFolders(
  library: TidyLibrary,
  options: TidyOrphansOptions,
): Promise<TidyOrphansResult> {
  const report = await tidyReport(library);
  const root = await readTree(library.source, true);
  const batchId = options.batchId ?? randomUUID();
  const folders: TidiedFolder[] = [];
  let moved = 0;
  const total = report.orphanFolders.length;
  options.onProgress?.(0, total, '');

  for (const orphan of report.orphanFolders) {
    options.onProgress?.(folders.length, total, orphan.path);
    const skip = (reason: OrphanSkipReason, twin?: string): void => {
      folders.push({
        path: orphan.path,
        ...(twin !== undefined && { twin }),
        status: 'skipped',
        reason,
        files: orphan.files,
      });
    };
    if (orphan.otherFiles > 0) {
      skip('other-files');
      continue;
    }
    if (orphan.files === 0) {
      await removeEmptyFolder(orphan.path, options.dryRun, folders);
      continue;
    }
    const found = findTwin(orphan.path, root);
    const twin = found?.path;
    const approximate = found?.approximate ? ({ approximate: true } as const) : {};
    if (twin === undefined) {
      skip('no-twin');
      continue;
    }
    if (options.dryRun) {
      folders.push({
        path: orphan.path,
        twin,
        ...approximate,
        status: 'would-remove',
        files: orphan.files,
      });
      continue;
    }

    // The tree is read again: a video that landed since the report makes this a work's folder.
    const now = await readTree(orphan.path, true).catch(() => undefined);
    if (now === undefined || now.videos > 0 || now.opaque) {
      skip('changed', twin);
      continue;
    }
    const outcome = await moveFolderAway(now, batchId, options);
    moved += outcome.moved;
    folders.push({
      path: orphan.path,
      twin,
      ...approximate,
      status: outcome.error ? 'failed' : 'removed',
      files: orphan.files,
      ...(outcome.error && { error: outcome.error, moved: outcome.moved }),
    });
  }
  return { batchId: moved > 0 ? batchId : null, folders };
}

/**
 * A folder with no file anywhere under it has nothing to keep, so it needs no twin and no journal
 * entry (undo would only recreate an empty folder). It goes folder by folder, deepest first, with
 * `rmdir`, which refuses a folder that got a file meanwhile.
 */
async function removeEmptyFolder(
  path: string,
  dryRun: boolean,
  results: TidiedFolder[],
): Promise<void> {
  const base = { path, files: 0, empty: true } as const;
  if (dryRun) {
    results.push({ ...base, status: 'would-remove' });
    return;
  }
  const now = await readTree(path, true).catch(() => undefined);
  if (now === undefined || now.videos > 0 || now.opaque || contentOf(now).files.length > 0) {
    results.push({ ...base, status: 'skipped', reason: 'changed' });
    return;
  }
  try {
    for (const folder of contentOf(now).folders) {
      await rmdir(folder);
    }
    results.push({ ...base, status: 'removed' });
  } catch (error) {
    results.push({ ...base, status: 'failed', moved: 0, error: describeFsError(error, path).info });
  }
}

async function moveFolderAway(
  folder: Folder,
  batchId: string,
  options: TidyOrphansOptions,
): Promise<{ moved: number; error?: ErrorInfo }> {
  const { files, folders } = contentOf(folder);
  let moved = 0;
  for (const file of files) {
    try {
      await takeOut(file, batchId, options);
      moved++;
    } catch (error) {
      // What already moved is journaled and can be undone; the folder stays with what is left.
      return { moved, error: describeFsError(error, file).info };
    }
  }
  // Only the folders that are now empty go: anything that arrived meanwhile keeps its folder.
  for (const path of folders) {
    await rmdir(path).catch(() => undefined);
  }
  return { moved };
}

/** Moves one file to the backup folder and journals it (`removed`): undo puts it back. */
export async function takeOut(
  file: string,
  batchId: string,
  options: { readonly journal: Journal; readonly backupDir: string },
): Promise<void> {
  const { size, mtimeMs } = await stat(file);
  await mkdir(options.backupDir, { recursive: true });
  const backup = join(options.backupDir, `${randomUUID()}${extname(file)}`);
  await moveFile(file, backup);
  options.journal.record({
    id: randomUUID(),
    batchId,
    kind: 'removed',
    source: '',
    destination: file,
    backup,
    createdDirectories: [],
    at: new Date().toISOString(),
    identity: { size, mtimeMs },
  });
}
