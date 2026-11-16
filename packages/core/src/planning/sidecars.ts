import { readdir } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { VIDEO_EXTENSIONS } from '../pipeline/discover.js';
import { readSubtitleName } from './languages.js';

export const DEFAULT_SIDECAR_EXTENSIONS: readonly string[] = [
  'srt',
  'ass',
  'ssa',
  'sub',
  'idx',
  'vtt',
  'sup',
  'smi',
  'mks',
  'nfo',
];

export interface Sidecar {
  readonly path: string;
  /** What follows the video's base name, e.g. `.en.srt`; kept as is on the destination. */
  readonly suffix: string;
}

/** A subtitle of a `Subs` folder that was not taken, and why: nothing is ever renamed at random. */
export interface LeftBehind {
  readonly path: string;
  readonly reason: 'language-unknown' | 'language-taken';
}

/** Folders where a release keeps its subtitles, next to the video. */
const SUBTITLE_FOLDERS = new Set(['subs', 'sub', 'subtitles', 'subtitle']);

/**
 * Files next to a video that belong to it: same base name, then `.<anything>.<ext>` with a
 * known sidecar extension (`Movie.mkv` → `Movie.srt`, `Movie.en.forced.srt`, `Movie.nfo`), and the
 * subtitles of the release's `Subs` folder, which are named by what they say (`subtitleFolderSidecars`).
 */
export async function findSidecars(
  source: string,
  extensions: readonly string[] = DEFAULT_SIDECAR_EXTENSIONS,
  /** Folder listings already asked for, shared by the videos of one plan: a season is read once. */
  listings?: Map<string, Promise<string[]>>,
  /** Off for a page that says what lies beside the video, not what a rename would take. */
  withSubtitleFolders = true,
): Promise<Sidecar[]> {
  return (await sidecarsOf(source, extensions, listings, withSubtitleFolders)).sidecars;
}

/** `findSidecars`, and the files of a `Subs` folder it left where they are. */
export async function sidecarsOf(
  source: string,
  extensions: readonly string[] = DEFAULT_SIDECAR_EXTENSIONS,
  listings?: Map<string, Promise<string[]>>,
  withSubtitleFolders = true,
): Promise<{ sidecars: Sidecar[]; left: LeftBehind[] }> {
  const stem = basename(source, extname(source));
  const folder = dirname(source);
  const list = async (directory: string): Promise<string[]> => {
    try {
      const listing = listings?.get(directory) ?? readdir(directory);
      listings?.set(directory, listing);
      return await listing;
    } catch {
      return [];
    }
  };
  const names = await list(folder);

  const beside = names
    .filter(
      (name) =>
        name !== basename(source) &&
        name.startsWith(`${stem}.`) &&
        extensions.includes(extname(name).slice(1).toLowerCase()),
    )
    .sort()
    .map((name) => ({ path: `${dirname(source)}/${name}`, suffix: name.slice(stem.length) }));

  if (!withSubtitleFolders) {
    return { sidecars: beside, left: [] };
  }
  const inFolders = await subtitleFolderSidecars(source, names, extensions, list, beside);
  return { sidecars: [...beside, ...inFolders.found], left: inFolders.left };
}

const isVideo = (name: string): boolean =>
  VIDEO_EXTENSIONS.includes(extname(name).slice(1).toLowerCase());

/** A sample is not a work of its own: it does not stop a folder from holding one video. */
const isSample = (name: string): boolean => /(^|[^a-z])sample([^a-z]|$)/i.test(name);

/** `s01e02` and `1x02` alike, so a release's `Subs/Show.S01E02/` finds its episode. */
function episodeTag(name: string): string | undefined {
  const found = /s(\d{1,3})[ ._-]?e(\d{1,3})|(?:^|[^\d])(\d{1,2})x(\d{2,3})(?!\d)/i.exec(name);
  if (!found) {
    return undefined;
  }
  return `${Number(found[1] ?? found[3])}x${Number(found[2] ?? found[4])}`;
}

/**
 * The subtitles of a release's `Subs` folder (`Subs/2_French.srt`, `Subs/Show.S01E02/3_English.srt`),
 * which no name ties to the video. They go next to it as `<video>.<language>.<ext>`, the language
 * read from the name (`readSubtitleName`, ISO 639-1), with `.forced` and `.sdh` kept: both are
 * read by Plex, Jellyfin and Kodi. A file whose language is not told stays where it is, and so does
 * a second one for a language already taken (the first, by name, wins): none is ever renamed at random.
 *
 * Which video a file belongs to: any of them when the folder holds one video, else the one whose
 * name the file's name (or its sub-folder's) starts, or the same season and episode.
 */
async function subtitleFolderSidecars(
  source: string,
  names: readonly string[],
  extensions: readonly string[],
  list: (directory: string) => Promise<string[]>,
  beside: readonly Sidecar[],
): Promise<{ found: Sidecar[]; left: LeftBehind[] }> {
  const subtitleExtensions = extensions.filter((extension) => extension !== 'nfo');
  const isSubtitle = (name: string): boolean =>
    subtitleExtensions.includes(extname(name).slice(1).toLowerCase());

  const folder = dirname(source);
  const stem = basename(source, extname(source));
  const wanted = names.filter((name) => SUBTITLE_FOLDERS.has(name.toLowerCase())).sort();
  if (wanted.length === 0) {
    return { found: [], left: [] };
  }
  const lone = names.filter((name) => isVideo(name) && !isSample(name)).length === 1;
  const lowerStem = stem.toLowerCase();
  const tag = episodeTag(stem);
  const mine = (name: string): boolean => {
    if (lone) {
      return true;
    }
    const lower = name.toLowerCase();
    return (
      lower.startsWith(lowerStem) ||
      (lower.length > 0 && lowerStem.startsWith(lower)) ||
      (tag !== undefined && episodeTag(name) === tag)
    );
  };

  // A pair (`.idx` and `.sub`) shares its base name and so its language: they are one group.
  const groups = new Map<string, { base: string; files: string[] }>();
  const add = (directory: string, file: string): void => {
    const base = basename(file, extname(file));
    const key = join(directory, base);
    const group = groups.get(key) ?? { base, files: [] };
    group.files.push(join(directory, file));
    groups.set(key, group);
  };
  for (const subs of wanted) {
    const directory = join(folder, subs);
    for (const entry of [...(await list(directory))].sort()) {
      if (isSubtitle(entry)) {
        if (mine(basename(entry, extname(entry)))) {
          add(directory, entry);
        }
      } else if (mine(entry)) {
        // A folder named like an episode has dots in its name (`Show.S01E01.1080p`): an entry that
        // is a file lists as nothing.
        const inner = join(directory, entry);
        for (const file of [...(await list(inner))].sort()) {
          if (isSubtitle(file)) {
            add(inner, file);
          }
        }
      }
    }
  }

  const taken = new Set(beside.map((sidecar) => sidecar.suffix.toLowerCase()));
  const found: Sidecar[] = [];
  const left: LeftBehind[] = [];
  for (const group of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const { base, files } = group[1];
    // What follows the video's name in `Subs/Movie.fr.srt` is all that is read of it.
    const residual = base.toLowerCase().startsWith(lowerStem) ? base.slice(stem.length) : base;
    const { language, forced, sdh } = readSubtitleName(residual);
    if (language === undefined) {
      left.push(...files.map((path): LeftBehind => ({ path, reason: 'language-unknown' })));
      continue;
    }
    const label = `.${language}${forced ? '.forced' : ''}${sdh ? '.sdh' : ''}`;
    const suffixes = files.map((file) => `${label}${extname(file)}`);
    if (suffixes.some((suffix) => taken.has(suffix.toLowerCase()))) {
      left.push(...files.map((path): LeftBehind => ({ path, reason: 'language-taken' })));
      continue;
    }
    files.forEach((path, index) => {
      found.push({ path, suffix: suffixes[index] as string });
      taken.add((suffixes[index] as string).toLowerCase());
    });
  }
  return { found, left };
}

/** A subtitle file beside a video, as a page lists it. */
export interface ExternalSubtitle {
  /** ISO 639-1 as read from its name; `undefined` when the name names none we know. */
  readonly language: string | undefined;
  readonly forced: boolean;
  readonly sdh: boolean;
}

/**
 * The subtitles beside a video (`Movie.fr.srt`, `Movie.en.forced.srt`), each pair of `.idx` and
 * `.sub` once, in the order of their names. Nothing is renamed or moved: this is what a page says
 * of the disk as it is, so a file that follows no rule of ours (`Movie.English.srt`) is read too.
 */
export async function findSubtitles(source: string): Promise<ExternalSubtitle[]> {
  const subtitleExtensions = DEFAULT_SIDECAR_EXTENSIONS.filter((extension) => extension !== 'nfo');
  const found = new Map<string, ExternalSubtitle>();
  for (const { suffix } of await findSidecars(source, subtitleExtensions, undefined, false)) {
    // What follows the video's name, minus the extension: `.en.forced`.
    const subtitle = readSubtitleName(suffix.slice(0, suffix.length - extname(suffix).length));
    found.set(
      `${subtitle.language ?? ''}|${String(subtitle.forced)}|${String(subtitle.sdh)}`,
      subtitle,
    );
  }
  return [...found.values()];
}
