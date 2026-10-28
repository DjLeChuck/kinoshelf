import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
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
}

async function* walk(directory: string): AsyncGenerator<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    // Hidden entries include our own `.kinoshelf-tmp` files, which must never be picked up.
    if (entry.name.startsWith('.')) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path); // Symbolic links are not followed: no loops, no escaping the root.
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

/** Video files under a directory, or the file itself when given one. */
export async function discoverVideos(
  input: string,
  extensions: readonly string[] = VIDEO_EXTENSIONS,
): Promise<DiscoveredFile[]> {
  const root = resolve(input);
  let info;
  try {
    info = await stat(root);
  } catch {
    throw new KinoshelfError('discover.not-found', { path: root });
  }

  const isVideo = (path: string): boolean =>
    extensions.includes(extname(path).slice(1).toLowerCase());
  const base = info.isDirectory() ? root : dirname(root);
  const paths: string[] = [];
  if (info.isDirectory()) {
    for await (const path of walk(root)) {
      paths.push(path);
    }
  } else {
    paths.push(root);
  }

  return paths.filter(isVideo).map((path) => ({
    path,
    displayPath: info.isDirectory() ? relative(root, path) : basename(path),
    parserPath: relative(dirname(base), path),
  }));
}
