import { lstat, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { errnoCode, KinoshelfError } from '../errors.js';
import { describeFsError } from '../execution/fs-ops.js';
import { VIDEO_EXTENSIONS } from '../pipeline/discover.js';

/** What a report looks at: a library organized in place (an arrival folder is never tidied). */
export interface TidyLibrary {
  readonly id: string;
  readonly type: 'movie' | 'series';
  readonly source: string;
}

/** The kinds of metadata file another tool names after the video. */
export type ForeignKind = 'nfo' | 'poster' | 'fanart' | 'logo';

/** A folder with no video anywhere under it, at a depth where a work or a season lives. */
export interface OrphanFolder {
  readonly path: string;
  /** Files directly in it and in its sub-folders. */
  readonly files: number;
  readonly sizeBytes: number;
  /** Paths relative to the folder, the first `ENTRY_LIMIT`; sub-folders end with a slash. */
  readonly entries: readonly string[];
  /** Files that are neither an NFO, an image nor a subtitle: the ones worth a look before removing. */
  readonly otherFiles: number;
}

/** A metadata file named after a video (`Film (2026)-poster.jpg`) rather than as the profile writes it. */
export interface ForeignFile {
  readonly path: string;
  readonly kind: ForeignKind;
  readonly sizeBytes: number;
  /** The name Kinoshelf writes for the same thing, in the same folder. */
  readonly counterpart: string;
  /** Whether that file is already there, which is what makes removing this one safe. */
  readonly counterpartPresent: boolean;
}

export interface TidyReport {
  readonly library: TidyLibrary;
  readonly orphanFolders: readonly OrphanFolder[];
  /** Movie libraries only: a series' NFO and images are named after the video by design. */
  readonly foreignFiles: readonly ForeignFile[];
}

/** How many names of an orphan folder's content a report lists. */
export const ENTRY_LIMIT = 20;

/**
 * The names other tools give next to a video (Kodi's own, which Radarr and tinyMediaManager write):
 * `<video>.nfo`, `<video>-poster.jpg`, `<video>-fanart.jpg`, `<video>-clearlogo.png`. In a movie
 * library Kinoshelf writes `movie.nfo`, `poster.jpg`, `fanart.jpg`, `clearlogo.png` instead, so these
 * are never read as its own.
 */
const FOREIGN_SUFFIXES: readonly {
  readonly suffix: string;
  readonly kind: ForeignKind;
  readonly counterpart: string;
}[] = [
  { suffix: '.nfo', kind: 'nfo', counterpart: 'movie.nfo' },
  { suffix: '-poster.jpg', kind: 'poster', counterpart: 'poster.jpg' },
  { suffix: '-poster.png', kind: 'poster', counterpart: 'poster.jpg' },
  { suffix: '-fanart.jpg', kind: 'fanart', counterpart: 'fanart.jpg' },
  { suffix: '-fanart.png', kind: 'fanart', counterpart: 'fanart.jpg' },
  { suffix: '-clearlogo.png', kind: 'logo', counterpart: 'clearlogo.png' },
];

/** Folders that belong to a NAS or a file system, never to a library. */
function isSystemFolder(name: string): boolean {
  return name.startsWith('.') || name === '@eaDir' || name === '#recycle' || name === 'lost+found';
}

const isVideoName = (name: string): boolean =>
  VIDEO_EXTENSIONS.includes(extname(name).slice(1).toLowerCase());

interface Folder {
  readonly path: string;
  readonly files: string[];
  readonly folders: Folder[];
  /** A link or an unreadable folder somewhere below: what is under it cannot be judged. */
  opaque: boolean;
  /** Videos in this folder and below. */
  videos: number;
}

async function readTree(path: string, isRoot: boolean): Promise<Folder> {
  const folder: Folder = { path, files: [], folders: [], opaque: false, videos: 0 };
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (!isRoot) {
      folder.opaque = true;
      return folder;
    }
    const code = errnoCode(error);
    throw code === 'ENOENT' || code === 'ENOTDIR'
      ? new KinoshelfError('discover.not-found', { path })
      : describeFsError(error, path);
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (isSystemFolder(entry.name)) {
        continue;
      }
      const child = await readTree(join(path, entry.name), false);
      folder.folders.push(child);
      folder.videos += child.videos;
      folder.opaque ||= child.opaque;
    } else if (entry.isFile()) {
      folder.files.push(entry.name);
      if (isVideoName(entry.name)) {
        folder.videos++;
      }
    } else {
      // A link may point at a video kept elsewhere: the folder is not one to call empty of videos.
      folder.opaque = true;
    }
  }
  return folder;
}

const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/**
 * Reads a library and says what clutters it, deleting and writing nothing:
 * - folders holding no video at the depth of a work (a movie's folder, a show's, a season's);
 *   deeper ones belong to a work that has videos (`Subs`, `Extras`) and are never listed;
 * - in a movie library, metadata files named after the video instead of as the profile writes them.
 *
 * A folder with a link or an unreadable part below it is skipped: it cannot be said to be empty.
 */
export async function tidyReport(library: TidyLibrary): Promise<TidyReport> {
  const root = await readTree(library.source, true);
  const orphanDepths = library.type === 'series' ? 2 : 1;

  const orphans: OrphanFolder[] = [];
  const collect = async (folder: Folder, depth: number): Promise<void> => {
    for (const child of folder.folders) {
      if (child.videos === 0 && !child.opaque) {
        orphans.push(await describeOrphan(child));
      } else if (depth < orphanDepths) {
        await collect(child, depth + 1);
      }
    }
  };
  await collect(root, 1);

  const foreign: ForeignFile[] = [];
  if (library.type === 'movie') {
    const visit = async (folder: Folder): Promise<void> => {
      foreign.push(...(await foreignFilesOf(folder)));
      for (const child of folder.folders) {
        await visit(child);
      }
    };
    await visit(root);
  }

  return {
    library,
    orphanFolders: orphans.sort(byPath),
    foreignFiles: foreign.sort(byPath),
  };
}

/** NFO, artwork and subtitles are what a leftover folder normally holds. */
const EXPECTED_EXTENSIONS: ReadonlySet<string> = new Set([
  'nfo',
  'jpg',
  'jpeg',
  'png',
  'srt',
  'ass',
  'ssa',
  'sub',
  'idx',
  'vtt',
]);

async function describeOrphan(folder: Folder): Promise<OrphanFolder> {
  const entries: string[] = [];
  let files = 0;
  let sizeBytes = 0;
  let otherFiles = 0;
  const walk = async (current: Folder, prefix: string): Promise<void> => {
    for (const name of current.files.toSorted()) {
      files++;
      sizeBytes += (await lstat(join(current.path, name)).catch(() => undefined))?.size ?? 0;
      if (!EXPECTED_EXTENSIONS.has(extname(name).slice(1).toLowerCase())) {
        otherFiles++;
      }
      entries.push(`${prefix}${name}`);
    }
    for (const child of current.folders) {
      const name = child.path.slice(current.path.length + 1);
      entries.push(`${prefix}${name}/`);
      await walk(child, `${prefix}${name}/`);
    }
  };
  await walk(folder, '');
  return {
    path: folder.path,
    files,
    sizeBytes,
    entries: entries.slice(0, ENTRY_LIMIT),
    otherFiles,
  };
}

async function foreignFilesOf(folder: Folder): Promise<ForeignFile[]> {
  const present = new Set(folder.files);
  const found: ForeignFile[] = [];
  for (const video of folder.files.filter(isVideoName)) {
    const stem = video.slice(0, video.length - extname(video).length);
    for (const { suffix, kind, counterpart } of FOREIGN_SUFFIXES) {
      const name = `${stem}${suffix}`;
      // A video named `movie.mkv` would otherwise make the profile's own `movie.nfo` foreign.
      if (!present.has(name) || name === counterpart) {
        continue;
      }
      const path = join(folder.path, name);
      const stats = await lstat(path).catch(() => undefined);
      found.push({
        path,
        kind,
        sizeBytes: stats?.size ?? 0,
        counterpart,
        counterpartPresent: present.has(counterpart),
      });
    }
  }
  return found;
}
