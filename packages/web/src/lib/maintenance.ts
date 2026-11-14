import type { ErrorBody } from './arrivals.js';

/** One folder the tidy-up looked at (`folders.items` of a task). */
export interface TidyFolder {
  readonly path: string;
  /** The sibling holding the video this folder duplicates. */
  readonly twin?: string;
  /** The twin was found by title and year, not by name: worth a look. */
  readonly approximate?: boolean;
  readonly empty?: boolean;
  readonly status: 'would-remove' | 'removed' | 'skipped' | 'failed';
  readonly reason?: 'other-files' | 'no-twin' | 'changed';
  readonly files: number;
  readonly moved?: number;
  readonly error?: ErrorBody;
}

/** One piece of metadata named after the video (`files.items` of a task). */
export interface TidyFile {
  readonly path: string;
  readonly kind: 'nfo' | 'poster' | 'fanart' | 'logo';
  /** The name Kinoshelf writes for the same thing. */
  readonly counterpart: string;
  readonly action?: 'rename' | 'remove';
  readonly status: 'would-do' | 'done' | 'skipped' | 'failed';
  readonly reason?:
    'ours' | 'format' | 'no-counterpart' | 'versions' | 'nfo-not-requested' | 'changed';
  readonly error?: ErrorBody;
}

export interface TidyPart<T> {
  /** The batch of the History that undoes it, `null` when nothing was moved. */
  readonly batch: string | null;
  readonly items: readonly T[];
}

/** The latest tidy-up (or report) of a library: how far it has got while it runs, its result once it ends. */
export interface TidyTask {
  readonly library: string;
  readonly dryRun: boolean;
  readonly status: 'running' | 'done' | 'failed';
  readonly phase: 'reading' | 'folders' | 'files';
  readonly done: number;
  readonly total: number;
  readonly current: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly folders: TidyPart<TidyFolder> | null;
  readonly files: TidyPart<TidyFile> | null;
  readonly error: ErrorBody | null;
}

/** What `POST /api/maintenance/tidy` takes. */
export interface TidyRequest {
  readonly library: string;
  readonly dryRun: boolean;
  readonly nfo: boolean;
}

/** What a task found or did, counted for the summary lines and the confirmation. */
export interface TidyTally {
  /** Folders that go (or went) aside. */
  readonly folders: number;
  /** Folders left alone, by the reason. */
  readonly left: Record<'other-files' | 'no-twin' | 'changed', number>;
  /** Folders whose twin was only found by title and year. */
  readonly approximate: number;
  readonly renames: number;
  readonly removals: number;
  /** `<video>.nfo` files left because they were not asked for. */
  readonly nfoLeft: number;
  readonly failed: number;
}

const TO_DO: ReadonlySet<string> = new Set(['would-remove', 'removed']);

export function tallyOf(task: TidyTask): TidyTally {
  const left = { 'other-files': 0, 'no-twin': 0, changed: 0 };
  let folders = 0;
  let approximate = 0;
  let failed = 0;
  for (const folder of task.folders?.items ?? []) {
    if (TO_DO.has(folder.status)) {
      folders++;
      if (folder.approximate) {
        approximate++;
      }
    } else if (folder.status === 'failed') {
      failed++;
    } else if (folder.reason) {
      left[folder.reason]++;
    }
  }
  let renames = 0;
  let removals = 0;
  let nfoLeft = 0;
  for (const file of task.files?.items ?? []) {
    if (file.status === 'would-do' || file.status === 'done') {
      if (file.action === 'rename') {
        renames++;
      } else {
        removals++;
      }
    } else if (file.status === 'failed') {
      failed++;
    } else if (file.reason === 'nfo-not-requested') {
      nfoLeft++;
    }
  }
  return { folders, left, approximate, renames, removals, nfoLeft, failed };
}

/** Something would be moved: only then is there anything to confirm. */
export const hasWork = (tally: TidyTally): boolean =>
  tally.folders + tally.renames + tally.removals > 0;

/** Folders that share a parent: a show's seasons, or the folders loose in the library (`parent` empty). */
export interface FolderGroup {
  /** The parent folder, relative to the library's source (`Show (2020)`), `''` for a folder directly in it. */
  readonly parent: string;
  readonly folders: readonly TidyFolder[];
}

/**
 * Folders grouped under their parent, so a series library reads `Show` then its `Season 1`,
 * `Season 2` instead of a column of identical names. Groups and folders are by name, the loose
 * folders (a movie library) first.
 */
export function groupFolders(folders: readonly TidyFolder[], source: string): FolderGroup[] {
  const root = source.replace(/\/+$/, '');
  const groups = new Map<string, TidyFolder[]>();
  for (const folder of folders) {
    const relative = folder.path.startsWith(`${root}/`)
      ? folder.path.slice(root.length + 1)
      : folder.path;
    const cut = relative.lastIndexOf('/');
    const parent = cut < 0 ? '' : relative.slice(0, cut);
    groups.set(parent, [...(groups.get(parent) ?? []), folder]);
  }
  const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });
  return [...groups]
    .sort(([a], [b]) => byName(a, b))
    .map(([parent, items]) => ({
      parent,
      folders: [...items].sort((a, b) => byName(a.path, b.path)),
    }));
}
