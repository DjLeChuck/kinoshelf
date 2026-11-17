import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { describeFsError, exists, moveFile } from '../execution/fs-ops.js';
import { pruneVacated } from '../execution/prune.js';
import { VIDEO_EXTENSIONS } from '../pipeline/discover.js';
import { DEFAULT_SIDECAR_EXTENSIONS, sidecarsOf, type LeftBehind } from '../planning/sidecars.js';
import type { ErrorInfo } from '../types/errors.js';
import type { Journal } from '../types/journal.js';
import { readTree, type Folder, type TidyLibrary } from './tidy-report.js';

/** Why a subtitle was not moved. */
export type SubtitleSkipReason =
  /** The name it would take is already there (or another video of the batch took it): never overwritten. */
  | 'destination-exists'
  /** The file or its folder changed since the report. */
  | 'changed';

export interface TidiedSubtitle {
  readonly path: string;
  /** Beside the video, as `<video>.<language>[.forced][.sdh].<ext>`. */
  readonly destination: string;
  /** The `would-` form is a dry run. */
  readonly status: 'would-do' | 'done' | 'skipped' | 'failed';
  readonly reason?: SubtitleSkipReason;
  readonly error?: ErrorInfo;
}

export interface TidySubtitlesOptions {
  readonly journal: Journal;
  readonly dryRun: boolean;
  readonly batchId?: string;
  /** Told once the tree is read (`done` 0), then after each video: a big library is long to settle. */
  readonly onProgress?: (done: number, total: number, current: string) => void;
}

export interface TidySubtitlesResult {
  /** `null` when nothing was moved. */
  readonly batchId: string | null;
  readonly files: readonly TidiedSubtitle[];
  /** What stays in its `Subs` folder, and why: no language in the name, or that language is taken. */
  readonly left: readonly LeftBehind[];
}

const SUBTITLE_EXTENSIONS = DEFAULT_SIDECAR_EXTENSIONS.filter((extension) => extension !== 'nfo');

const isVideoName = (name: string): boolean =>
  VIDEO_EXTENSIONS.includes(extname(name).slice(1).toLowerCase());

/** Every folder of the tree, the root included. */
const flatten = (folder: Folder): Folder[] => [folder, ...folder.folders.flatMap(flatten)];

/**
 * Brings the subtitles of a `Subs` folder (`Subs`, `Sub`, `Subtitles`, `Subtitle`) next to the video
 * they belong to, in a library organized in place: what `analyze` does for a file that arrives, which
 * a video already named as the profile wants never goes through. The rules are the planner's own
 * (`sidecarsOf`): the language read from the name, `.forced` and `.sdh` kept, a file with no readable
 * language or a second one for a language taken left where it is, and told in `left`.
 *
 * One journaled batch of `move`s, so `undo` puts every file back; nothing is overwritten, nothing
 * deleted. The disk is read again right before each file moves. A `Subs` folder the move empties
 * goes (`pruneVacated`: only when nothing but our files or nothing is left in it).
 */
export async function tidySubtitles(
  library: TidyLibrary,
  options: TidySubtitlesOptions,
): Promise<TidySubtitlesResult> {
  const tree = await readTree(library.source, true);
  const videos = flatten(tree).flatMap((folder) =>
    folder.files.filter(isVideoName).map((name) => join(folder.path, name)),
  );
  const batchId = options.batchId ?? randomUUID();
  const files: TidiedSubtitle[] = [];
  const left = new Map<string, LeftBehind>();
  const claimed = new Set<string>();
  const vacated = new Set<string>();
  let changed = 0;
  const listings = new Map<string, Promise<string[]>>();
  options.onProgress?.(0, videos.length, '');

  for (const [index, video] of videos.entries()) {
    options.onProgress?.(index, videos.length, video);
    const found = await sidecarsOf(video, SUBTITLE_EXTENSIONS, listings);
    for (const entry of found.left) {
      left.set(`${entry.path}|${entry.reason}`, entry);
    }
    const stem = basename(video, extname(video));
    // What lies beside the video already is where it should be: only what a `Subs` folder holds moves.
    for (const sidecar of found.sidecars.filter(({ path }) => dirname(path) !== dirname(video))) {
      const destination = join(dirname(video), `${stem}${sidecar.suffix}`);
      const base = { path: sidecar.path, destination } as const;
      if (claimed.has(sidecar.path)) {
        continue;
      }
      claimed.add(sidecar.path);
      const present = await stat(sidecar.path).then(
        () => true,
        () => false,
      );
      if (!present) {
        files.push({ ...base, status: 'skipped', reason: 'changed' });
        continue;
      }
      if (
        (await exists(destination)) ||
        files.some((f) => f.destination === destination && f.status !== 'skipped')
      ) {
        files.push({ ...base, status: 'skipped', reason: 'destination-exists' });
        continue;
      }
      if (options.dryRun) {
        files.push({ ...base, status: 'would-do' });
        continue;
      }
      try {
        const { size, mtimeMs } = await stat(sidecar.path);
        await moveFile(sidecar.path, destination);
        options.journal.record({
          id: randomUUID(),
          batchId,
          kind: 'transfer',
          mode: 'move',
          source: sidecar.path,
          destination,
          createdDirectories: [],
          at: new Date().toISOString(),
          identity: { size, mtimeMs },
        });
        vacated.add(dirname(sidecar.path));
        changed++;
        files.push({ ...base, status: 'done' });
      } catch (error) {
        files.push({ ...base, status: 'failed', error: describeFsError(error, sidecar.path).info });
      }
    }
  }
  if (vacated.size > 0) {
    await pruneVacated([...vacated], library.source, options.journal);
  }
  return { batchId: changed > 0 ? batchId : null, files, left: [...left.values()] };
}
