import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { KinoshelfError } from '../errors.js';

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
 * `movie-sample.mkv`) or anything inside a `Sample` folder. By name only: a size check would
 * need a stat per file and could drop a genuinely short film.
 */
export function isSample(path: string): boolean {
  const segments = path.split(/[\\/]+/);
  const name = (segments.pop() ?? '').replace(/\.[^.]+$/, '');
  return (
    /(^|[\s._\-[(])sample($|[\s._\-\])])/i.test(name) || segments.some((s) => /^samples?$/i.test(s))
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
   * Told of a folder under the root that could not be read (`lost+found` owned by root), which is
   * left out: one such folder must not fail the scan of a whole library. The root itself still does.
   */
  readonly onUnreadable?: (path: string, error: unknown) => void;
}

async function* walk(
  directory: string,
  onUnreadable: DiscoverOptions['onUnreadable'],
  isRoot = true,
): AsyncGenerator<string> {
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
      yield* walk(path, onUnreadable, false);
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

  const base = info.isDirectory() ? root : dirname(root);
  // A sample is judged below the scanned root: a library kept under `/srv/samples` is not one.
  const isVideo = (path: string): boolean =>
    extensions.includes(extname(path).slice(1).toLowerCase()) && !isSample(relative(base, path));
  const paths: string[] = [];
  if (info.isDirectory()) {
    for await (const path of walk(root, options.onUnreadable)) {
      if (isVideo(path)) {
        paths.push(path);
        onFound?.(paths.length);
      }
    }
  } else if (isVideo(root)) {
    paths.push(root);
    onFound?.(1);
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

  return paths.map((path) => ({
    path,
    displayPath: info.isDirectory() ? relative(root, path) : basename(path),
    parserPath: relative(dirname(base), path),
    release: releaseOf(path),
  }));
}
