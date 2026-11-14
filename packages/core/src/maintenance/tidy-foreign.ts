import { randomUUID } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { describeFsError, exists, moveFile } from '../execution/fs-ops.js';
import { VIDEO_EXTENSIONS } from '../pipeline/discover.js';
import type { ErrorInfo } from '../types/errors.js';
import type { Journal } from '../types/journal.js';
import { takeOut } from './tidy-orphans.js';
import { tidyReport, type ForeignFile, type TidyLibrary } from './tidy-report.js';

export type ForeignSkipReason =
  /** Kinoshelf's own journal knows the file: it is not another tool's. */
  | 'ours'
  /** The image would have to change format to take Kinoshelf's name (`-poster.png` to `poster.jpg`). */
  | 'format'
  /** An NFO named after the video with no `movie.nfo` beside it: nothing says which one players read. */
  | 'no-counterpart'
  /** Several videos in the folder: a `<video>.nfo` may be a version's own. */
  | 'versions'
  /** An NFO, and `includeNfo` is off. */
  | 'nfo-not-requested'
  /** The file or the folder changed since the report. */
  | 'changed';

export interface TidiedForeignFile {
  readonly path: string;
  readonly kind: ForeignFile['kind'];
  readonly counterpart: string;
  /** `rename`: Kinoshelf's name is not there, the file takes it. `remove`: it is, the file goes aside. */
  readonly action?: 'rename' | 'remove';
  /** The `would-` forms are a dry run. */
  readonly status: 'would-do' | 'done' | 'skipped' | 'failed';
  readonly reason?: ForeignSkipReason;
  readonly error?: ErrorInfo;
}

export interface TidyForeignOptions {
  readonly journal: Journal;
  /** Where what is taken out is kept (`<config>/replaced`), so undo can bring it back. */
  readonly backupDir: string;
  readonly dryRun: boolean;
  /**
   * Also handle the `<video>.nfo` files. Off by default: Kodi and Jellyfin read `<video>.nfo`
   * before `movie.nfo`, and what a given player does with the pair is for the owner to check.
   */
  readonly includeNfo?: boolean;
  readonly batchId?: string;
}

export interface TidyForeignResult {
  /** `null` when nothing was moved. */
  readonly batchId: string | null;
  readonly files: readonly TidiedForeignFile[];
}

const isVideoName = (name: string): boolean =>
  VIDEO_EXTENSIONS.includes(extname(name).slice(1).toLowerCase());

/**
 * Deals with the metadata another tool named after the video (`Film-poster.jpg`, `Film.nfo`) in a
 * movie library, as one journaled batch, nothing deleted:
 * - Kinoshelf's name is **not** there: an image is renamed to it (a `transfer` in place, so undo
 *   moves it back), which is better than downloading it again;
 * - it **is** there: the foreign file is taken out to `backupDir` (`removed`, undoable).
 * An NFO is only ever taken out, and only with `includeNfo`, when `movie.nfo` exists and the folder
 * holds one video. A file the journal made is never touched. The report is read again, and the
 * disk once more right before each file moves.
 */
export async function tidyForeignFiles(
  library: TidyLibrary,
  options: TidyForeignOptions,
): Promise<TidyForeignResult> {
  const report = await tidyReport(library);
  const batchId = options.batchId ?? randomUUID();
  const files: TidiedForeignFile[] = [];
  let changed = 0;

  for (const found of report.foreignFiles) {
    const base = { path: found.path, kind: found.kind, counterpart: found.counterpart } as const;
    const skip = (reason: ForeignSkipReason): void => {
      files.push({ ...base, status: 'skipped', reason });
    };
    if (options.journal.madeFileIdentity(found.path) !== undefined) {
      skip('ours');
      continue;
    }
    const folder = dirname(found.path);
    const target = join(folder, found.counterpart);
    const stillThere = await stat(found.path).then(
      () => true,
      () => false,
    );
    if (!stillThere) {
      skip('changed');
      continue;
    }
    const targetPresent = await exists(target);

    let action: 'rename' | 'remove';
    if (found.kind === 'nfo') {
      if (!options.includeNfo) {
        skip('nfo-not-requested');
        continue;
      }
      if (!targetPresent) {
        skip('no-counterpart');
        continue;
      }
      if ((await readdir(folder)).filter(isVideoName).length > 1) {
        skip('versions');
        continue;
      }
      action = 'remove';
    } else if (targetPresent) {
      action = 'remove';
    } else if (extname(found.path).toLowerCase() !== extname(found.counterpart)) {
      skip('format');
      continue;
    } else {
      action = 'rename';
    }

    if (options.dryRun) {
      files.push({ ...base, action, status: 'would-do' });
      continue;
    }
    try {
      if (action === 'remove') {
        await takeOut(found.path, batchId, options);
      } else {
        const { size, mtimeMs } = await stat(found.path);
        await moveFile(found.path, target);
        options.journal.record({
          id: randomUUID(),
          batchId,
          kind: 'transfer',
          mode: 'move',
          source: found.path,
          destination: target,
          createdDirectories: [],
          at: new Date().toISOString(),
          identity: { size, mtimeMs },
        });
      }
      changed++;
      files.push({ ...base, action, status: 'done' });
    } catch (error) {
      files.push({
        ...base,
        action,
        status: 'failed',
        error: describeFsError(error, found.path).info,
      });
    }
  }
  return { batchId: changed > 0 ? batchId : null, files };
}
