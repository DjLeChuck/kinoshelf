import { dirname } from 'node:path';
export interface PathMapping {
  /** A folder as Kinoshelf sees it… */
  readonly from: string;
  /** …and as the media server sees it. */
  readonly to: string;
}

const trimSlashes = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path);

/** One folder is, or is inside, the other; `/media/movies2` is not inside `/media/movies`. */
export function isInside(path: string, folder: string): boolean {
  const root = trimSlashes(folder);
  return path === root || path.startsWith(root === '/' ? '/' : `${root}/`);
}

/**
 * The path as the media server sees it. Without any mapping the paths are the same; with some, a
 * path that none covers cannot be translated and comes back `undefined`, rather than a wrong
 * guess that would make the media server look at nothing.
 */
export function mapPath(path: string, mappings: readonly PathMapping[] = []): string | undefined {
  if (mappings.length === 0) {
    return path;
  }
  const mapping = mappings.find(({ from }) => isInside(path, from));
  if (!mapping) {
    return undefined;
  }
  return trimSlashes(mapping.to) + path.slice(trimSlashes(mapping.from).length);
}

/**
 * What may appear in a log. A webhook URL often holds its own secret (a Discord URL is one, a
 * Gotify `?token=` too), so only the host is kept.
 */
export function redactUrl(url: string): string {
  try {
    return `${new URL(url).origin}/…`;
  } catch {
    return '[invalid url]';
  }
}

/** What `POST /api/batches/{id}/undo` says of one file, as far as the media servers are concerned. */
export interface RevertedFile {
  readonly destination: string;
  readonly status: string;
  readonly mode: string;
}

/**
 * The folders whose NFO or images an undo took back (or took away), for the media servers to look
 * at again, each with the kind of library holding it. A folder that is gone is left out: there is
 * nothing in it to look at. Videos are not named here, so a move back is not reported.
 */
export function revertedFolders(
  files: readonly RevertedFile[],
  libraries: readonly { source: string; type?: 'movie' | 'series' | undefined }[],
  exists: (path: string) => boolean,
): { path: string; kind: 'movie' | 'series' }[] {
  const folders = new Map<string, { path: string; kind: 'movie' | 'series' }>();
  for (const file of files) {
    if (file.status !== 'undone' || !['generated', 'downloaded', 'replaced'].includes(file.mode)) {
      continue;
    }
    const path = dirname(file.destination);
    const kind = libraries.find(
      (library) => library.type !== undefined && isInside(path, library.source),
    )?.type;
    if (kind !== undefined && exists(path)) {
      folders.set(path, { path, kind });
    }
  }
  return [...folders.values()];
}
