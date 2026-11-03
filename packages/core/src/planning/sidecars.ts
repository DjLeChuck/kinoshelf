import { readdir } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';

export const DEFAULT_SIDECAR_EXTENSIONS: readonly string[] = [
  'srt',
  'ass',
  'ssa',
  'sub',
  'idx',
  'vtt',
  'sup',
  'nfo',
];

export interface Sidecar {
  readonly path: string;
  /** What follows the video's base name, e.g. `.en.srt`; kept as is on the destination. */
  readonly suffix: string;
}

/**
 * Files next to a video that belong to it: same base name, then `.<anything>.<ext>` with a
 * known sidecar extension (`Movie.mkv` → `Movie.srt`, `Movie.en.forced.srt`, `Movie.nfo`).
 */
export async function findSidecars(
  source: string,
  extensions: readonly string[] = DEFAULT_SIDECAR_EXTENSIONS,
  /** Folder listings already asked for, shared by the videos of one plan: a season is read once. */
  listings?: Map<string, Promise<string[]>>,
): Promise<Sidecar[]> {
  const stem = basename(source, extname(source));
  const folder = dirname(source);
  let names: string[];
  try {
    const listing = listings?.get(folder) ?? readdir(folder);
    listings?.set(folder, listing);
    names = await listing;
  } catch {
    return [];
  }

  return names
    .filter(
      (name) =>
        name !== basename(source) &&
        name.startsWith(`${stem}.`) &&
        extensions.includes(extname(name).slice(1).toLowerCase()),
    )
    .sort()
    .map((name) => ({ path: `${dirname(source)}/${name}`, suffix: name.slice(stem.length) }));
}
