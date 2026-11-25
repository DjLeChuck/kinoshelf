import { lstat, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { KinoshelfError, throwIfCancelled } from '../errors.js';

export const VIDEO_EXTENSIONS: readonly string[] = [
  'mkv',
  'mp4',
  'm4v',
  'avi',
  'mov',
  'wmv',
  'flv',
  'webm',
  'mpg',
  'mpeg',
  'ts',
  'm2ts',
  'iso',
];

/**
 * Promotional extracts shipped with a release: a file named `sample` (`sample.avi`,
 * `movie-sample.mkv`) or anything inside a `Sample` folder. By name only; a sample under an
 * ordinary name is caught by size, beside its siblings (`tooSmall`).
 */
export function isSample(path: string): boolean {
  const segments = path.split(/[\\/]+/);
  const name = (segments.pop() ?? '').replace(/\.[^.]+$/, '');
  return (
    /(^|[\s._\-[(])sample($|[\s._\-\])])/i.test(name) || segments.some((s) => /^samples?$/i.test(s))
  );
}

/**
 * A video is a sample (or a trailer) when it is under this share of the largest video of its
 * folder and under `SMALL_VIDEO_MAX_BYTES`: both, so a short film kept beside a feature in a pile
 * of unrelated downloads is not taken for one.
 */
export const SMALL_VIDEO_RATIO = 0.05;
export const SMALL_VIDEO_MAX_BYTES = 256 * 1024 * 1024;

/** A video left out because of its size, told to `onSkipped` so that nothing disappears silently. */
export interface SkippedVideo {
  readonly path: string;
  /** Path relative to the scanned root, for display. */
  readonly displayPath: string;
  readonly size: number;
  /** The largest video beside it, which it is compared with. */
  readonly largest: number;
}

/**
 * The videos of a folder that are far smaller than the largest one (`SMALL_VIDEO_RATIO`, under
 * `SMALL_VIDEO_MAX_BYTES`). Needs two videos at least: a lone file is never judged.
 */
export function tooSmall(sizes: readonly number[]): boolean[] {
  const largest = Math.max(0, ...sizes);
  return sizes.map(
    (size) =>
      sizes.length > 1 &&
      largest > 0 &&
      size < largest * SMALL_VIDEO_RATIO &&
      size < SMALL_VIDEO_MAX_BYTES,
  );
}

export interface DiscoveredFile {
  /** Absolute path of the video. */
  readonly path: string;
  /** Path relative to the scanned root, for display. */
  readonly displayPath: string;
  /**
   * What is given to the parser: the path from the scanned root's own folder name down, so
   * `Show/Season 1/e01.mkv` keeps `Show` even when scanning the `Show` folder directly.
   */
  readonly parserPath: string;
  /**
   * Absolute path of the release the video belongs to: a download is handled as a whole, not file
   * by file. A folder directly under the scanned root when the root holds releases
   * (`splitReleases`), the scanned folder itself otherwise, and the file alone when given one.
   */
  readonly release: string;
}

export interface DiscoverOptions {
  /** The scanned folder holds releases side by side: each child is one (a loose file is its own). */
  readonly splitReleases?: boolean;
  /**
   * The folder the parser's paths start from, when the scanned one is only a part of it: a season
   * read on its own still names the show's folder and the library's, as a scan of the whole would.
   * Defaults to the scanned folder.
   */
  readonly parserRoot?: string;
  /**
   * Told of a folder under the root that could not be read (`lost+found` owned by root), which is
   * left out: one such folder must not fail the scan of a whole library. The root itself still does.
   */
  readonly onUnreadable?: (path: string, error: unknown) => void;
  /** Told of a video left out for being far smaller than its siblings (a sample with a plain name). */
  readonly onSkipped?: (video: SkippedVideo) => void;
  /** Aborted by a caller that gave up: the walk stops with `task.cancelled`. */
  readonly signal?: AbortSignal;
}

async function* walk(
  directory: string,
  onUnreadable: DiscoverOptions['onUnreadable'],
  signal: AbortSignal | undefined,
  isRoot = true,
): AsyncGenerator<string> {
  throwIfCancelled(signal);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isRoot) {
      throw error;
    }
    onUnreadable?.(directory, error);
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    // Hidden entries include our own `.kinoshelf-tmp` files, which must never be picked up.
    if (entry.name.startsWith('.')) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      // Symbolic links are not followed: no loops, no escaping the root.
      yield* walk(path, onUnreadable, signal, false);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

/** Video files under a directory, or the file itself when given one. */
export async function discoverVideos(
  input: string,
  extensions: readonly string[] = VIDEO_EXTENSIONS,
  /** Told how many videos were found so far, while the walk goes on (a big library takes a while). */
  onFound?: (found: number) => void,
  options: DiscoverOptions = {},
): Promise<DiscoveredFile[]> {
  const root = resolve(input);
  let info;
  try {
    info = await stat(root);
  } catch {
    throw new KinoshelfError('discover.not-found', { path: root });
  }

  // A link to a file is skipped like the links met while walking a folder: moving it would carry
  // the link, not the video, and leave a dangling one at the destination.
  if (!info.isDirectory() && (await lstat(root)).isSymbolicLink()) {
    return [];
  }

  const base = info.isDirectory() ? root : dirname(root);
  // A sample is judged below the scanned root: a library kept under `/srv/samples` is not one.
  const isVideo = (path: string): boolean =>
    extensions.includes(extname(path).slice(1).toLowerCase()) && !isSample(relative(base, path));
  const paths: string[] = [];
  if (info.isDirectory()) {
    for await (const path of walk(root, options.onUnreadable, options.signal)) {
      if (isVideo(path)) {
        paths.push(path);
        onFound?.(paths.length);
      }
    }
  } else if (isVideo(root)) {
    paths.push(root);
    onFound?.(1);
  }

  // Judged folder by folder, so a pile of unrelated downloads in one folder is the only way to be
  // wrong, and the size ceiling covers that.
  const byFolder = new Map<string, string[]>();
  for (const path of paths) {
    const folder = dirname(path);
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), path]);
  }
  const small = new Set<string>();
  for (const [folder, siblings] of byFolder) {
    // Loose files of a root that holds releases side by side are releases of their own: a pile
    // of unrelated downloads is not one.
    if (siblings.length < 2 || (options.splitReleases && folder === root)) {
      continue;
    }
    throwIfCancelled(options.signal);
    const sizes: number[] = [];
    try {
      for (const path of siblings) {
        sizes.push((await stat(path)).size);
      }
    } catch {
      // A file gone since the walk: the folder cannot be judged, so every video is kept.
      continue;
    }
    const largest = Math.max(...sizes);
    tooSmall(sizes).forEach((flag, index) => {
      const path = siblings[index];
      const size = sizes[index];
      if (flag && path !== undefined && size !== undefined) {
        small.add(path);
        options.onSkipped?.({
          path,
          displayPath: info.isDirectory() ? relative(root, path) : basename(path),
          size,
          largest,
        });
      }
    });
  }

  const releaseOf = (path: string): string => {
    if (!info.isDirectory()) {
      return path;
    }
    if (!options.splitReleases) {
      return root;
    }
    const [first] = relative(root, path).split(sep);
    return first === undefined ? path : join(root, first);
  };

  return paths
    .filter((path) => !small.has(path))
    .map((path) => ({
      path,
      displayPath: info.isDirectory() ? relative(root, path) : basename(path),
      parserPath: relative(dirname(options.parserRoot ? resolve(options.parserRoot) : base), path),
      release: releaseOf(path),
    }));
}
