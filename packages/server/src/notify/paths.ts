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
