import { createHash } from 'node:crypto';
import { basename, dirname, extname } from 'node:path';
import {
  libraryProfile,
  companionKindOf,
  companionsWritten,
  loadProfile,
  type Candidate,
  type CompanionKind,
  type Config,
  type JournalEntry,
  type LibraryConfig,
  type Operation,
  type OperationResult,
  type Profile,
} from '@kinoshelf/core';
import type { Database, Statement } from 'better-sqlite3';
import { workKindOf as kindOf, type Entry, type EntryStore } from './entries.js';
import { isInside } from './notify/paths.js';
import type { Job, JobStore } from './jobs.js';
import type { Probe } from './probe.js';

/**
 * - `review`: a human must decide (ambiguous, or a conflict).
 * - `rename`: matched, the video is not where the profile wants it yet.
 * - `unrecognized`: nothing was found for it.
 * - `incomplete`: well placed, but an NFO or an image is missing beside it.
 * - `ok`: nothing to do.
 */
export type ItemState = 'review' | 'rename' | 'unrecognized' | 'incomplete' | 'ok';

/** `null` when the profile writes no such file (or it cannot be told, see `presenceOf`). */
type Presence = boolean | null;

/** One video of a library as its last scan saw it. */
export interface LibraryItem {
  readonly libraryId: string;
  /** Where the video is now. */
  readonly path: string;
  readonly kind: 'movie' | 'series' | null;
  readonly tmdbId: number | null;
  readonly title: string | null;
  readonly year: number | null;
  /** Series only: the episode(s) the file holds. `episodeEnd` is set for a multi-episode file. */
  readonly season: number | null;
  readonly episode: number | null;
  readonly episodeEnd: number | null;
  readonly state: ItemState;
  readonly nfo: Presence;
  readonly poster: Presence;
  readonly fanart: Presence;
  /** The entry of the scan that saw it: what to validate or re-match. */
  readonly entryId: string | null;
  readonly scanJobId: string | null;
  readonly scannedAt: string;
}

interface Row {
  library_id: string;
  path: string;
  kind: 'movie' | 'series' | null;
  tmdb_id: number | null;
  title: string | null;
  year: number | null;
  season: number | null;
  episode: number | null;
  episode_end: number | null;
  state: ItemState;
  nfo: number | null;
  poster: number | null;
  fanart: number | null;
  entry_id: string | null;
  scan_job_id: string | null;
  scanned_at: string;
}

const COLUMNS =
  'library_id, path, kind, tmdb_id, title, year, season, episode, episode_end, state, nfo, poster, fanart, entry_id, scan_job_id, scanned_at';

/** The columns a row is written with: `item_id` is derived from the path, never read back. */
const WRITTEN_COLUMNS = `${COLUMNS}, item_id`;

interface ProbeRow {
  path: string;
  video: string | null;
  audio: string | null;
  size: number | null;
  mtime: number | null;
  probed_at: string | null;
}

const PROBE_COLUMNS = 'path, video, audio, size, mtime, probed_at';

const bit = (value: Presence): number | null => (value === null ? null : value ? 1 : 0);
const flag = (value: number | null): Presence => (value === null ? null : value === 1);

/** The values of a row, in the order of `COLUMNS`. */
const valuesOf = (item: LibraryItem): (string | number | null)[] => [
  item.libraryId,
  item.path,
  item.kind,
  item.tmdbId,
  item.title,
  item.year,
  item.season,
  item.episode,
  item.episodeEnd,
  item.state,
  bit(item.nfo),
  bit(item.poster),
  bit(item.fanart),
  item.entryId,
  item.scanJobId,
  item.scannedAt,
  itemId(item.path),
];

const toItem = (row: Row): LibraryItem => ({
  libraryId: row.library_id,
  path: row.path,
  kind: row.kind,
  tmdbId: row.tmdb_id,
  title: row.title,
  year: row.year,
  season: row.season,
  episode: row.episode,
  episodeEnd: row.episode_end,
  state: row.state,
  nfo: flag(row.nfo),
  poster: flag(row.poster),
  fanart: flag(row.fanart),
  entryId: row.entry_id,
  scanJobId: row.scan_job_id,
  scannedAt: row.scanned_at,
});

/** What a library holds, in the database: a snapshot, not a second source of truth for the disk. */
interface ShowFilter {
  query?: string;
  missing?: boolean;
  /** Only the shows lacking a file of their own (`tvshow.nfo`, an image) or of a season. */
  incomplete?: boolean;
}

export class LibraryItemStore {
  constructor(private readonly database: Database) {}

  /** A scan ended: what it saw replaces what the library held, as a whole. */
  replace(libraryId: string, items: readonly LibraryItem[]): void {
    this.database.transaction(() => {
      // A file that is still there keeps what was probed of it: its size and date say if it changed.
      const kept = new Map(
        this.database
          .prepare<[string], ProbeRow>(
            `SELECT ${PROBE_COLUMNS} FROM library_items WHERE library_id = ?`,
          )
          .all(libraryId)
          .map((row) => [row.path, row]),
      );
      this.database.prepare('DELETE FROM library_items WHERE library_id = ?').run(libraryId);
      // Prepared once: preparing per row costs more than the insert itself on a large library.
      const put = this.putStatement();
      const restore = this.database.prepare(
        `UPDATE library_items SET video = ?, audio = ?, size = ?, mtime = ?, probed_at = ?
         WHERE library_id = ? AND path = ?`,
      );
      for (const item of items) {
        put.run(...valuesOf(item));
        const probe = kept.get(item.path);
        if (probe?.probed_at) {
          restore.run(
            probe.video,
            probe.audio,
            probe.size,
            probe.mtime,
            probe.probed_at,
            libraryId,
            item.path,
          );
        }
      }
    })();
  }

  /** Moves a row to another path, probe included: it is the same file, and its date will tell. */
  rename(libraryId: string, from: string, to: string): void {
    this.database.transaction(() => {
      this.database
        .prepare('DELETE FROM library_items WHERE library_id = ? AND path = ?')
        .run(libraryId, to);
      this.database
        .prepare('UPDATE library_items SET path = ?, item_id = ? WHERE library_id = ? AND path = ?')
        .run(to, itemId(to), libraryId, from);
    })();
  }

  probeOf(libraryId: string, path: string): (Probe & { probedAt: string | null }) | undefined {
    const row = this.database
      .prepare<[string, string], ProbeRow>(
        `SELECT ${PROBE_COLUMNS} FROM library_items WHERE library_id = ? AND path = ?`,
      )
      .get(libraryId, path);
    return (
      row && {
        video: row.video,
        audio: row.audio,
        size: row.size ?? 0,
        mtime: row.mtime ?? 0,
        probedAt: row.probed_at,
      }
    );
  }

  setProbe(libraryId: string, path: string, probe: Probe): void {
    this.database
      .prepare(
        `UPDATE library_items SET video = ?, audio = ?, size = ?, mtime = ?, probed_at = ?
         WHERE library_id = ? AND path = ?`,
      )
      .run(
        probe.video,
        probe.audio,
        probe.size,
        probe.mtime,
        new Date().toISOString(),
        libraryId,
        path,
      );
  }

  /** The rows nobody looked at yet. */
  unprobed(libraryId: string): string[] {
    return this.database
      .prepare<[string], { path: string }>(
        'SELECT path FROM library_items WHERE library_id = ? AND probed_at IS NULL ORDER BY path',
      )
      .all(libraryId)
      .map(({ path }) => path);
  }

  private putStatement(): Statement {
    return this.database.prepare(
      // An upsert, not a replacement: what ffprobe learned of the file is not the scan's to erase.
      `INSERT INTO library_items (${WRITTEN_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (library_id, path) DO UPDATE SET ${WRITTEN_COLUMNS.split(', ')
         .slice(2)
         .map((column) => `${column} = excluded.${column}`)
         .join(', ')}`,
    );
  }

  put(item: LibraryItem): void {
    this.putStatement().run(...valuesOf(item));
  }

  get(libraryId: string, path: string): LibraryItem | undefined {
    const row = this.database
      .prepare<[string, string], Row>(
        `SELECT ${COLUMNS} FROM library_items WHERE library_id = ? AND path = ?`,
      )
      .get(libraryId, path);
    return row && toItem(row);
  }

  /**
   * Everything known of a library's content (its rows, its shows' counts and files): a library
   * deleted or pointed at another folder must not find them again under the same id.
   */
  forget(libraryId: string): void {
    this.database.transaction(() => {
      for (const table of ['library_items', 'series_completeness', 'series_files']) {
        this.database.prepare(`DELETE FROM ${table} WHERE library_id = ?`).run(libraryId);
      }
    })();
  }

  remove(libraryId: string, path: string): void {
    this.database
      .prepare('DELETE FROM library_items WHERE library_id = ? AND path = ?')
      .run(libraryId, path);
  }

  /** The videos of a library, in path order. */
  all(libraryId: string): LibraryItem[] {
    return this.database
      .prepare<[string], Row>(
        `SELECT ${COLUMNS} FROM library_items WHERE library_id = ? ORDER BY path`,
      )
      .all(libraryId)
      .map(toItem);
  }

  /** The rows with these ids (as the web names them), in path order. */
  byItemIds(libraryId: string, ids: readonly string[]): LibraryItem[] {
    this.fillItemIds(libraryId);
    return this.database
      .prepare<[string, string], Row>(
        `SELECT ${COLUMNS} FROM library_items
         WHERE library_id = ? AND item_id IN (SELECT value FROM json_each(?))
         ORDER BY path`,
      )
      .all(libraryId, JSON.stringify(ids))
      .map(toItem);
  }

  /** Rows saved before `item_id` existed get theirs, once. */
  private fillItemIds(libraryId: string): void {
    const missing = this.database
      .prepare<[string], { path: string }>(
        'SELECT path FROM library_items WHERE library_id = ? AND item_id IS NULL',
      )
      .all(libraryId);
    if (missing.length === 0) {
      return;
    }
    const set = this.database.prepare(
      'UPDATE library_items SET item_id = ? WHERE library_id = ? AND path = ?',
    );
    this.database.transaction(() => {
      for (const { path } of missing) {
        set.run(itemId(path), libraryId, path);
      }
    })();
  }

  /** The files of one show of a series library, by path. */
  ofShow(libraryId: string, tmdbId: number): LibraryItem[] {
    return this.database
      .prepare<[string, number], Row>(
        `SELECT ${COLUMNS} FROM library_items
         WHERE library_id = ? AND tmdb_id = ? AND kind = 'series' ORDER BY path`,
      )
      .all(libraryId, tmdbId)
      .map(toItem);
  }

  /** One page of a library, by title (a file nobody recognized by its name), optionally filtered. */
  page(
    libraryId: string,
    options: { filter?: ItemFilter; query?: string; limit: number; offset: number },
  ): { total: number; items: LibraryItem[] } {
    const where = [
      'library_id = ?',
      ...(options.filter ? [FILTER_SQL[options.filter]] : []),
      ...(options.query
        ? ["(lower(title) LIKE ? ESCAPE '\\' OR lower(path) LIKE ? ESCAPE '\\')"]
        : []),
    ].join(' AND ');
    const params: (string | number)[] = [
      libraryId,
      ...(options.query
        ? [contains(options.query.toLowerCase()), contains(options.query.toLowerCase())]
        : []),
    ];
    const total =
      this.database
        .prepare<unknown[], { total: number }>(
          `SELECT COUNT(*) AS total FROM library_items WHERE ${where}`,
        )
        .get(...params)?.total ?? 0;
    const items = this.database
      .prepare<unknown[], Row>(
        `SELECT ${COLUMNS} FROM library_items WHERE ${where}
         ORDER BY lower(COALESCE(title, path)), path LIMIT ? OFFSET ?`,
      )
      .all(...params, options.limit, options.offset)
      .map(toItem);
    return { total, items };
  }

  /** What each filter holds, for the tabs of the page. */
  counts(libraryId: string): ItemCounts {
    const counts = { all: 0 } as ItemCounts;
    const count = (extra: string): number =>
      this.database
        .prepare<[string], { total: number }>(
          `SELECT COUNT(*) AS total FROM library_items WHERE library_id = ?${extra}`,
        )
        .get(libraryId)?.total ?? 0;
    counts.all = count('');
    for (const filter of ITEM_FILTERS) {
      counts[filter] = count(` AND ${FILTER_SQL[filter]}`);
    }
    // Counted in shows, not files: it is the list of shows that this filter narrows.
    counts['missing-episodes'] = this.countShows(libraryId, { missing: true });
    counts['missing-show-files'] = this.countShows(libraryId, { incomplete: true });
    return counts;
  }

  /**
   * The shows of a series library, one row each, by title. `missing` is what was last counted
   * (`null`: not yet, see `Completeness`). Files nobody identified (no work id) are not shows.
   */
  shows(
    libraryId: string,
    options: ShowFilter & { limit: number; offset: number },
  ): { total: number; items: ShowRow[] } {
    const { grouped, params } = this.groupedShows(libraryId, options);
    const total = this.countShows(libraryId, options);
    const rows = this.database
      .prepare<unknown[], ShowQuery>(`${grouped} ORDER BY lower(title), tmdb_id LIMIT ? OFFSET ?`)
      .all(...params, options.limit, options.offset);
    return {
      total,
      items: rows.map((row) => ({
        tmdbId: row.tmdb_id,
        title: row.title,
        year: row.year,
        seasons: row.seasons,
        episodes: row.episodes,
        missing: row.missing,
        nfo: flag(row.nfo),
        poster: flag(row.poster),
        fanart: flag(row.fanart),
      })),
    };
  }

  /** The query of the shows, one row each, and its parameters. */
  private groupedShows(
    libraryId: string,
    options: ShowFilter,
  ): { grouped: string; params: (string | number)[] } {
    const where = [
      "i.library_id = ? AND i.kind = 'series' AND i.tmdb_id IS NOT NULL",
      ...(options.query ? ["lower(i.title) LIKE ? ESCAPE '\\'"] : []),
      // A season's row only ever carries its poster, so one check covers the show and its seasons.
      ...(options.incomplete
        ? [
            `EXISTS (SELECT 1 FROM series_files m WHERE m.library_id = i.library_id
               AND m.tmdb_id = i.tmdb_id AND (m.nfo = 0 OR m.poster = 0 OR m.fanart = 0))`,
          ]
        : []),
    ].join(' AND ');
    const having = options.missing ? 'HAVING MAX(c.missing) > 0' : '';
    const params: (string | number)[] = [
      libraryId,
      ...(options.query ? [contains(options.query.toLowerCase())] : []),
    ];
    const grouped = `
      SELECT i.tmdb_id AS tmdb_id, MIN(i.title) AS title, MIN(i.year) AS year,
        COUNT(DISTINCT i.season) AS seasons,
        SUM(CASE WHEN i.episode IS NULL THEN 1
                 ELSE COALESCE(i.episode_end, i.episode) - i.episode + 1 END) AS episodes,
        MAX(c.missing) AS missing,
        MAX(f.nfo) AS nfo, MAX(f.poster) AS poster, MAX(f.fanart) AS fanart
      FROM library_items i
      LEFT JOIN series_completeness c ON c.library_id = i.library_id AND c.tmdb_id = i.tmdb_id
      LEFT JOIN series_files f
        ON f.library_id = i.library_id AND f.tmdb_id = i.tmdb_id AND f.season = -1
      WHERE ${where} GROUP BY i.tmdb_id ${having}`;
    return { grouped, params };
  }

  /** How many shows a filter keeps; the count alone, without reading a page of them. */
  private countShows(libraryId: string, options: ShowFilter): number {
    const { grouped, params } = this.groupedShows(libraryId, options);
    return (
      this.database
        .prepare<unknown[], { total: number }>(`SELECT COUNT(*) AS total FROM (${grouped})`)
        .get(...params)?.total ?? 0
    );
  }

  /** When the snapshot was last replaced by a scan; `null` for a library never scanned. */
  scannedAt(libraryId: string): string | null {
    return (
      this.database
        .prepare<[string], { at: string | null }>(
          'SELECT MAX(scanned_at) AS at FROM library_items WHERE library_id = ?',
        )
        .get(libraryId)?.at ?? null
    );
  }

  /** The videos of a folder: where the files an undone batch wrote sat beside. */
  inFolder(libraryId: string, folder: string): LibraryItem[] {
    // A range on the primary key: every path under `folder/` sorts between `folder/` and
    // `folder0` ('0' follows '/'). Sub-folders are in that range too, hence the filter.
    return this.database
      .prepare<[string, string, string], Row>(
        `SELECT ${COLUMNS} FROM library_items
         WHERE library_id = ? AND path >= ? AND path < ? ORDER BY path`,
      )
      .all(libraryId, `${folder}/`, `${folder}0`)
      .map(toItem)
      .filter((item) => dirname(item.path) === folder);
  }
}

/** The views of a library: a state, or a kind of file that is missing. */
export const ITEM_FILTERS = [
  'review',
  'rename',
  'unrecognized',
  'missing-nfo',
  'missing-artwork',
] as const;
export type ItemFilter = (typeof ITEM_FILTERS)[number];

const FILTER_SQL: Record<ItemFilter, string> = {
  review: "state = 'review'",
  rename: "state = 'rename'",
  unrecognized: "state = 'unrecognized'",
  'missing-nfo': 'nfo = 0',
  'missing-artwork': '(poster = 0 OR fanart = 0)',
};

export type ItemCounts = Record<
  ItemFilter | 'all' | 'missing-episodes' | 'missing-show-files',
  number
>;

/** A show of a series library, with what its files make of it. */
export interface ShowRow {
  readonly tmdbId: number;
  readonly title: string | null;
  readonly year: number | null;
  readonly seasons: number;
  readonly episodes: number;
  /** Aired episodes no file holds, as last counted; `null` until it was. */
  readonly missing: number | null;
  /** The show's own files (`tvshow.nfo`, poster, fanart); `null`: not written, or not looked at. */
  readonly nfo: Presence;
  readonly poster: Presence;
  readonly fanart: Presence;
}

interface ShowQuery {
  tmdb_id: number;
  title: string | null;
  year: number | null;
  seasons: number;
  episodes: number;
  missing: number | null;
  nfo: number | null;
  poster: number | null;
  fanart: number | null;
}

/** A LIKE pattern that matches the text itself, `%` and `_` included. */
const contains = (text: string): string => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

type Writable = CompanionKind;

/** Which files the profile writes for a work of this kind (none for a file nobody identified). */
const writes = (profile: Profile, kind: 'movie' | 'series' | null): Record<Writable, boolean> =>
  kind === null
    ? { nfo: false, poster: false, fanart: false }
    : companionsWritten(profile, kind, kind === 'movie' && profile.templates.movieFolder === '');

/** What an NFO or image path is, according to the profile; `undefined` for any other file. */
const fileKind = (profile: Profile, destination: string): Writable | undefined =>
  companionKindOf(profile, basename(destination));

const isTransfer = (operation: Operation): boolean => operation.type === 'transfer';

/** The state a planned item leaves its video in, and what is still to write beside it. */
function describe(
  entry: Pick<Entry, 'classification' | 'item'>,
  profile: Profile,
  kind: 'movie' | 'series' | null,
): { state: ItemState } & Record<Writable, Presence> {
  const none = { nfo: null, poster: null, fanart: null };
  const { classification, item } = entry;
  if (classification === 'unrecognized') {
    return { state: 'unrecognized', ...none };
  }
  if (classification === 'ambiguous' || classification === 'conflict' || !item) {
    return { state: 'review', ...none };
  }
  const wanted = writes(profile, kind);
  const missing = new Set<Writable>();
  for (const operation of item.operations) {
    const type =
      operation.type === 'transfer' ? undefined : fileKind(profile, operation.destination);
    if (type) {
      missing.add(type);
    }
  }
  const presence = (name: Writable): Presence => (wanted[name] ? !missing.has(name) : null);
  const moves = item.operations.some(isTransfer);
  const result = { nfo: presence('nfo'), poster: presence('poster'), fanart: presence('fanart') };
  const state: ItemState = moves
    ? 'rename'
    : Object.values(result).some((value) => value === false)
      ? 'incomplete'
      : 'ok';
  // A movie to rename has all of its files still to come: they are not there to be missing.
  return { state, ...result };
}

/** What a profile writes for a library of this type, which drives the columns of its page. */
export function profileWrites(
  profile: Profile,
  type: 'movie' | 'series',
): { nfo: boolean; artwork: boolean } {
  if (type === 'series') {
    return {
      nfo: profile.nfo !== null,
      artwork: profile.artwork.some(({ kind }) => kind === 'poster' || kind === 'fanart'),
    };
  }
  const wanted = writes(profile, 'movie');
  return { nfo: wanted.nfo, artwork: wanted.poster || wanted.fanart };
}

/** The picture size a release name announces (`2160p`, `4K`…), the one cheap thing it says of the video. */
export function resolutionOf(path: string): string | null {
  const match = /(?<![a-z0-9])(2160p|1440p|1080p|720p|576p|480p|4k|uhd)(?![a-z0-9])/i.exec(
    basename(path),
  );
  const found = match?.[1]?.toLowerCase();
  return found === undefined ? null : found === '4k' || found === 'uhd' ? '2160p' : found;
}

/** Stable for a path, short enough for a URL; the page asks for one item by it. */
export const itemId = (path: string): string =>
  createHash('sha1').update(path).digest('hex').slice(0, 16);

/** The row for a file of a scan, from the entry the scan stored for it. */
function itemOf(
  entry: Entry,
  profile: Profile,
  libraryId: string,
  scannedAt: string,
  matched?: Candidate,
): LibraryItem {
  const kind = kindOf(entry);
  // The work the file is planned for, among the candidates the entry keeps.
  const best =
    matched ?? entry.candidates.find((candidate) => candidate.id.id === entry.item?.externalId.id);
  const episodes = kind === 'series' ? entry.parsed.episodes : [];
  return {
    libraryId,
    path: entry.path,
    kind,
    tmdbId: entry.item?.externalId.id ?? null,
    title: best?.title ?? entry.parsed.title ?? null,
    year: best?.year ?? entry.parsed.year ?? null,
    season: kind === 'series' ? (entry.parsed.season ?? null) : null,
    // A range keeps its two ends: what lies between is covered, and counted so.
    episode: episodes.length > 0 ? Math.min(...episodes) : null,
    episodeEnd: episodes.length > 1 ? Math.max(...episodes) : null,
    ...describe(entry, profile, kind),
    entryId: entry.id,
    scanJobId: entry.jobId,
    scannedAt,
  };
}

/**
 * Keeps the snapshot of the libraries organized in place up to date: written when a scan of the
 * whole source ends, then patched file by file as transfers and undos change the disk, so the page
 * never has to scan again to be right. A library that is an arrival folder has no snapshot (what
 * lands in it is waiting to go elsewhere).
 */
/**
 * The videos a written file belongs to: the one it is named after (`<video>.nfo`), else every
 * video of its folder (`movie.nfo`, `poster.jpg`: a movie folder holds one movie).
 */
function beside(rows: readonly LibraryItem[], written: string): readonly LibraryItem[] {
  const name = basename(written);
  const named = rows.filter((row) => name.startsWith(`${stemOf(row.path)}.`));
  return named.length > 0 ? named : rows;
}

const stemOf = (path: string): string => basename(path, extname(path));

/** The typed library a file sits in, if any. */
const typedLibraryHolding = (config: Config, path: string): LibraryConfig | undefined =>
  config.libraries?.find(
    ({ type, source }) => type !== undefined && path !== source && isInside(path, source),
  );

/**
 * The profile of each typed library, read once per call rather than once per file: a batch or an
 * undo of a whole series goes through thousands of them.
 */
function profilesOf(config: Config): (library: LibraryConfig) => Promise<Profile> {
  const profiles = new Map<string, Promise<Profile>>();
  return (library) => {
    const profile = profiles.get(library.id) ?? loadProfile(libraryProfile(library, config));
    profiles.set(library.id, profile);
    return profile;
  };
}

export class LibrarySnapshot {
  constructor(
    private readonly deps: {
      readonly config: () => Config;
      readonly jobs: JobStore;
      readonly entries: EntryStore;
      readonly store: LibraryItemStore;
      /** A library's rows changed (the shows of a series library are to be counted again). */
      readonly changed?: (libraryId: string) => void;
    },
  ) {}

  /** The typed library a job scanned in full, if it is one. */
  private libraryOf(job: Job | undefined): LibraryConfig | undefined {
    const library = this.deps.config().libraries?.find(({ id }) => id === job?.libraryId);
    return library?.type !== undefined && library.source === job?.path ? library : undefined;
  }

  private async profileOf(jobId: string): Promise<Profile | undefined> {
    const settings = this.deps.jobs.settings(jobId);
    return settings && loadProfile(settings.profile);
  }

  /** A scan of a library's whole source is done. */
  async scanned(job: Job): Promise<void> {
    const library = this.libraryOf(job);
    const profile = await this.profileOf(job.id);
    if (!library || !profile) {
      return;
    }
    const now = new Date().toISOString();
    this.deps.store.replace(
      library.id,
      this.deps.entries.mapList(job.id, (entry) => itemOf(entry, profile, library.id, now)),
    );
    this.deps.changed?.(library.id);
  }

  /** A human chose the work of a file: its row follows, with the title they chose. */
  async matched(entry: Entry, candidate: Candidate): Promise<void> {
    const job = this.deps.jobs.get(entry.jobId);
    const library = this.libraryOf(job);
    const profile = await this.profileOf(entry.jobId);
    const row = library && this.deps.store.get(library.id, entry.path);
    if (!library || !profile || !row) {
      return;
    }
    this.deps.store.put({
      ...itemOf(entry, profile, library.id, row.scannedAt, candidate),
      path: row.path,
    });
    this.deps.changed?.(library.id);
  }

  /** Transfers of a job ended: each video that went through is where it was sent, and written. */
  async transferred(
    jobId: string,
    done: readonly { readonly entry: Entry; readonly results: readonly OperationResult[] }[],
  ): Promise<void> {
    const library = this.libraryOf(this.deps.jobs.get(jobId));
    const profile = await this.profileOf(jobId);
    if (!library || !profile) {
      await this.arrived(done);
      return;
    }
    for (const { entry, results } of done) {
      const row = this.deps.store.get(library.id, entry.path);
      const main = results.find(
        (r) => r.operation.type === 'transfer' && r.operation.role === 'main',
      );
      if (!row || (main && main.status !== 'done')) {
        continue;
      }
      const written = new Set<Writable>(
        results
          .filter((r) => r.operation.type !== 'transfer' && r.status !== 'failed')
          .flatMap((r) => fileKind(profile, r.operation.destination) ?? []),
      );
      const path = main ? main.operation.destination : row.path;
      this.settle(row, path, written, 'present');
    }
  }

  /**
   * Videos that came from an arrival folder: each one that went through is now a row of the typed
   * library whose folder holds it, with what was written beside it. The library is told by where
   * the video landed, since a file's destination can be chosen one by one.
   */
  private async arrived(
    done: readonly { readonly entry: Entry; readonly results: readonly OperationResult[] }[],
  ): Promise<void> {
    const config = this.deps.config();
    const profileOf = profilesOf(config);
    const now = new Date().toISOString();
    for (const { entry, results } of done) {
      const main = results.find(
        (r) => r.operation.type === 'transfer' && r.operation.role === 'main',
      );
      const path = main?.status === 'done' ? main.operation.destination : undefined;
      const library = path === undefined ? undefined : typedLibraryHolding(config, path);
      if (path === undefined || !library) {
        continue;
      }
      const profile = await profileOf(library);
      const row = itemOf(entry, profile, library.id, now);
      const failed = new Set<Writable>(
        results
          .filter((r) => r.operation.type !== 'transfer' && r.status === 'failed')
          .flatMap((r) => fileKind(profile, r.operation.destination) ?? []),
      );
      // Everything the plan wrote is there now, unless it failed; the video itself was moved.
      const present = (name: Writable): Presence => (row[name] === null ? null : !failed.has(name));
      const next = { nfo: present('nfo'), poster: present('poster'), fanart: present('fanart') };
      this.deps.store.put({
        ...row,
        ...next,
        path,
        state: Object.values(next).some((value) => value === false) ? 'incomplete' : 'ok',
        entryId: null,
        scanJobId: null,
      });
      this.deps.changed?.(library.id);
    }
  }

  /**
   * A batch was undone: a video is back where it came from, and the files written beside the
   * others are gone. Files that sit in no typed library are not ours to track.
   */
  async undone(entries: readonly JournalEntry[]): Promise<void> {
    const config = this.deps.config();
    const profileOf = profilesOf(config);
    // The written files first: once a video is moved back, its folder is no longer the one to look in.
    const ordered = [...entries].sort(
      (a, b) => Number(a.kind === 'transfer') - Number(b.kind === 'transfer'),
    );
    for (const entry of ordered) {
      const library = typedLibraryHolding(config, entry.destination);
      if (!library) {
        continue;
      }
      if (entry.kind === 'transfer') {
        const row = this.deps.store.get(library.id, entry.destination);
        if (row && isInside(entry.source, library.source)) {
          this.settle(row, entry.source, new Set(), 'gone');
        } else if (row) {
          // Back in an arrival folder (or a copy's name gone): the library no longer holds it.
          this.deps.store.remove(library.id, entry.destination);
          this.deps.changed?.(library.id);
        }
        continue;
      }
      const kind = fileKind(await profileOf(library), entry.destination);
      if (kind === undefined) {
        continue;
      }
      for (const row of beside(
        this.deps.store.inFolder(library.id, dirname(entry.destination)),
        entry.destination,
      )) {
        this.settle(row, row.path, new Set<Writable>([kind]), 'gone');
      }
    }
  }

  /** Moves a row to `path` and says which of its files are now there (or gone). */
  private settle(
    row: LibraryItem,
    path: string,
    kinds: ReadonlySet<Writable>,
    change: 'present' | 'gone',
  ): void {
    const value = change === 'present';
    const apply = (name: Writable): Presence =>
      row[name] === null ? null : kinds.has(name) ? value : row[name];
    const next = { nfo: apply('nfo'), poster: apply('poster'), fanart: apply('fanart') };
    // After an undo the video is back at its source, to be renamed again.
    const missing = Object.values(next).some((presence) => presence === false);
    const state: ItemState =
      change === 'gone' && path !== row.path ? 'rename' : missing ? 'incomplete' : 'ok';
    if (path !== row.path) {
      this.deps.store.rename(row.libraryId, row.path, path);
    }
    this.deps.store.put({ ...row, ...next, path, state });
    this.deps.changed?.(row.libraryId);
  }
}
