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
): Promise<Sidecar[]> {
  const stem = basename(source, extname(source));
  let names: string[];
  try {
    names = await readdir(dirname(source));
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
