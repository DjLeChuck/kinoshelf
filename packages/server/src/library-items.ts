import { createHash } from 'node:crypto';
import { basename, dirname, extname } from 'node:path';
import {
  buildProfile,
  libraryProfile,
  companionKindOf,
  companionsWritten,
  type Candidate,
  type CompanionKind,
  type Config,
  type JournalEntry,
  type LibraryConfig,
  type Operation,
  type OperationResult,
  type Profile,
} from '@kinoshelf/core';
import type { Database, Statement } from '@kinoshelf/core';
import { workKindOf as kindOf, type Entry, type EntryStore } from './entries.js';
import { isInside } from './notify/paths.js';
import type { Job, JobStore } from './jobs.js';
import type { Hdr, Probe } from './probe.js';
import {
  showCoverageOf,
  distinctEpisodes,
  hasIncompleteVersion,
  hasSeveralVersions,
  type VersionCoverage,
  type VersionRow,
} from './versions.js';

/**
 * - `review`: a human must decide (ambiguous, or a conflict).
 * - `rename`: matched, the video is not where the profile wants it yet.
 * - `unrecognized`: nothing was found for it.
 * - `incomplete`: well placed, but an NFO or an image is missing beside it. For the first episode
 *   of a show it also means a file of the show, or a season's poster, is still to write: those
 *   belong to no column of an episode, but without this nothing could refresh them.
 * - `ok`: nothing to do.
 */
export type ItemState = 'review' | 'rename' | 'unrecognized' | 'incomplete' | 'ok';

/** `null` when the profile writes no such file (or it cannot be told, see `presenceOf`). */
type Presence = boolean | null;

type UnavailableImage = 'poster' | 'fanart' | 'logo';

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
  readonly logo: Presence;
  /** An episode's own image, `<file>-thumb.jpg`. */
  readonly thumb: Presence;
  /** The entry of the scan that saw it: what to validate or re-match. */
  readonly entryId: string | null;
  readonly scanJobId: string | null;
  readonly scannedAt: string;
  /** Images the profile writes that TMDB has none of (and the disk neither): shown as unavailable. */
  readonly unavailable: readonly UnavailableImage[];
  /** The picture size the probe read, the fallback when the name says none; `null` until probed. */
  readonly picture: string | null;
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
  logo: number | null;
  thumb: number | null;
  entry_id: string | null;
  scan_job_id: string | null;
  scanned_at: string;
  unavailable: string | null;
  picture: string | null;
}

const ROW_COLUMNS =
  'library_id, path, kind, tmdb_id, title, year, season, episode, episode_end, state, nfo, poster, fanart, logo, thumb, entry_id, scan_job_id, scanned_at, unavailable';

/** The columns a row is written with: `item_id` is derived from the path, never read back. */
const WRITTEN_COLUMNS = `${ROW_COLUMNS}, item_id, sort, work_key`;

/** Read with the picture size, which only the probe writes: a patch of a row never touches it. */
const COLUMNS = `${ROW_COLUMNS}, picture`;

interface ProbeRow {
  path: string;
  video: string | null;
  audio: string | null;
  hdr: string | null;
  audio_languages: string | null;
  subtitle_languages: string | null;
  picture: string | null;
  size: number | null;
  mtime: number | null;
  probed_at: string | null;
}

const PROBE_COLUMNS =
  'path, video, audio, hdr, audio_languages, subtitle_languages, picture, size, mtime, probed_at';
const PROBE_ASSIGNMENTS =
  'video = ?, audio = ?, hdr = ?, audio_languages = ?, subtitle_languages = ?, picture = ?, size = ?, mtime = ?, probed_at = ?';

const languages = (json: string | null): string[] =>
  json === null ? [] : (JSON.parse(json) as string[]);

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
  bit(item.logo),
  bit(item.thumb),
  item.entryId,
  item.scanJobId,
  item.scannedAt,
  item.unavailable.length > 0 ? JSON.stringify(item.unavailable) : null,
  itemId(item.path),
  sortOf(item),
  workKeyOf(item),
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
  logo: flag(row.logo),
  thumb: flag(row.thumb),
  entryId: row.entry_id,
  scanJobId: row.scan_job_id,
  scannedAt: row.scanned_at,
  unavailable: row.unavailable === null ? [] : (JSON.parse(row.unavailable) as UnavailableImage[]),
  picture: row.picture,
});

/** What a library holds, in the database: a snapshot, not a second source of truth for the disk. */
interface ShowFilter {
  query?: string;
  missing?: boolean;
  /** Only the shows lacking a file of their own (`tvshow.nfo`, an image) or of a season. */
  incomplete?: boolean;
  /**
   * Only the shows holding at least one file in this state (or lacking this kind of file), or
   * held in several versions (`multi-version`), or with a version short of an episode.
   */
  state?: ShowStateFilter;
  /** Only the shows held in several versions; combines with `state`. */
  multi?: boolean;
}

export class LibraryItemStore {
  private readonly generations = new Map<string, number>();
  private readonly memoized = new Map<
    string,
    { generation: number; values: Map<string, unknown> }
  >();

  constructor(private readonly database: Database) {
    // SQLite's lower() only folds ASCII, so "Ça" would sort after "Z": the key drops accents too.
    database.function('sort_key', { deterministic: true }, (value: unknown) =>
      typeof value === 'string' ? sortKey(value) : null,
    );
    this.fillSortKeys();
  }

  /** Rows saved before `sort` and `work_key` existed get theirs, once (migration 031). */
  private fillSortKeys(): void {
    const missing = this.database
      .prepare<[], KeyRow & { library_id: string }>(
        `SELECT library_id, path, kind, tmdb_id, title, state FROM library_items WHERE work_key IS NULL`,
      )
      .all();
    if (missing.length === 0) {
      return;
    }
    const set = this.database.prepare(
      'UPDATE library_items SET sort = ?, work_key = ? WHERE library_id = ? AND path = ?',
    );
    this.database.transaction(() => {
      for (const row of missing) {
        set.run(sortOf(keyedItem(row)), workKeyOf(keyedItem(row)), row.library_id, row.path);
      }
      for (const libraryId of new Set(missing.map((row) => row.library_id))) {
        this.regroup(libraryId);
      }
    })();
  }

  /**
   * Marks the first file of each work (`lead`, in the order of a list) again, for the works named
   * or for the whole library. A work's lead depends on its other files, so every write that adds,
   * removes or changes one calls this, in its own transaction.
   */
  private regroup(libraryId: string, keys?: ReadonlySet<string>): void {
    const scope = keys === undefined ? '' : ' AND work_key IN (SELECT value FROM json_each(?))';
    const args = keys === undefined ? [] : [JSON.stringify([...keys])];
    this.refreshCollections(libraryId, scope, args);
    this.database
      .prepare(
        `UPDATE library_items SET lead = CASE WHEN path IN (
           SELECT path FROM (
             SELECT path, ROW_NUMBER() OVER (PARTITION BY work_key ORDER BY sort, path) AS rank
             FROM library_items WHERE library_id = ?${scope}
           ) WHERE rank = 1) THEN 1 ELSE 0 END
         WHERE library_id = ?${scope}`,
      )
      .run(libraryId, ...args, libraryId, ...args);
  }

  /**
   * Files each movie under its effective collection (`collection_key`: `t:<id>` for the
   * provider's, `c:<name>` for the owner's, none for a movie in none), from what the provider
   * said and what the owner decided. Stored on the row so a list can filter and order by it; the
   * count of what the library holds is read, not stored (it moves with every other row).
   */
  private refreshCollections(libraryId: string, scope: string, args: readonly string[]): void {
    this.database
      .prepare(
        `UPDATE library_items AS t
         SET collection_key = x.key, collection_name = x.name, collection_total = x.total
         FROM (
           SELECT li.path AS path,
             CASE o.mode WHEN 'none' THEN NULL WHEN 'custom' THEN 'c:' || o.name
               ELSE CASE WHEN mc.collection_id IS NULL THEN NULL ELSE 't:' || mc.collection_id END
             END AS key,
             CASE o.mode WHEN 'none' THEN NULL WHEN 'custom' THEN o.name ELSE c.name END AS name,
             CASE WHEN o.mode IS NULL AND c.id IS NOT NULL
               THEN NULLIF(json_array_length(c.parts), 0) END AS total
           FROM library_items li
           LEFT JOIN collection_overrides o
             ON o.library_id = li.library_id AND o.movie_id = li.tmdb_id
           LEFT JOIN movie_collections mc ON mc.movie_id = li.tmdb_id
           LEFT JOIN collections c ON c.id = mc.collection_id
           WHERE li.library_id = ? AND li.kind = 'movie'${scope.replaceAll('work_key', 'li.work_key')}
         ) AS x
         WHERE t.library_id = ? AND t.path = x.path`,
      )
      .run(libraryId, ...args, libraryId);
  }

  /** The movies' collections were rewritten (an override, a scan): their rows follow. */
  refreshMovies(libraryId: string, movieIds: readonly number[]): void {
    this.changed(libraryId);
    this.database.transaction(() => {
      this.refreshCollections(libraryId, ' AND work_key IN (SELECT value FROM json_each(?))', [
        JSON.stringify(movieIds.map((id) => `m${String(id)}`)),
      ]);
    })();
  }

  /** The works the rows at these paths belong to (their stored key). */
  private workKeysAt(libraryId: string, where: string, args: readonly string[]): Set<string> {
    return new Set(
      this.database
        .prepare<string[], { work_key: string | null }>(
          `SELECT DISTINCT work_key FROM library_items WHERE library_id = ?${where}`,
        )
        .all(libraryId, ...args)
        .flatMap(({ work_key }) => (work_key === null ? [] : [work_key])),
    );
  }

  /**
   * A scan ended: what it saw replaces what the library held, as a whole, or only what lay under
   * `folder` when one folder was scanned (a file, when that is what was).
   */
  replace(libraryId: string, items: readonly LibraryItem[], folder?: string): void {
    this.changed(libraryId);
    // A range on the primary key: every path under `folder/` sorts between `folder/` and `folder0`.
    const scope =
      folder === undefined
        ? { where: '', args: [] as string[] }
        : {
            where: ' AND (path = ? OR (path >= ? AND path < ?))',
            args: [folder, `${folder}/`, `${folder}0`],
          };
    this.database.transaction(() => {
      const touched = this.workKeysAt(libraryId, scope.where, scope.args);
      // A file that is still there keeps what was probed of it: its size and date say if it changed.
      const kept = new Map(
        this.database
          .prepare<string[], ProbeRow>(
            `SELECT ${PROBE_COLUMNS} FROM library_items WHERE library_id = ?${scope.where}`,
          )
          .all(libraryId, ...scope.args)
          .map((row) => [row.path, row]),
      );
      this.database
        .prepare(`DELETE FROM library_items WHERE library_id = ?${scope.where}`)
        .run(libraryId, ...scope.args);
      // Prepared once: preparing per row costs more than the insert itself on a large library.
      const put = this.putStatement();
      const restore = this.database.prepare(
        `UPDATE library_items SET ${PROBE_ASSIGNMENTS}
         WHERE library_id = ? AND path = ?`,
      );
      for (const item of items) {
        put.run(...valuesOf(item));
        const probe = kept.get(item.path);
        if (probe?.probed_at) {
          restore.run(
            probe.video,
            probe.audio,
            probe.hdr,
            probe.audio_languages,
            probe.subtitle_languages,
            probe.picture,
            probe.size,
            probe.mtime,
            probe.probed_at,
            libraryId,
            item.path,
          );
        }
      }
      if (folder === undefined) {
        this.regroup(libraryId);
      } else {
        for (const item of items) {
          touched.add(workKeyOf(item));
        }
        this.regroup(libraryId, touched);
      }
    })();
  }

  /** Moves a row to another path, probe included: it is the same file, and its date will tell. */
  rename(libraryId: string, from: string, to: string): void {
    this.changed(libraryId);
    this.database.transaction(() => {
      const touched = this.workKeysAt(libraryId, ' AND path IN (?, ?)', [from, to]);
      this.database
        .prepare('DELETE FROM library_items WHERE library_id = ? AND path = ?')
        .run(libraryId, to);
      this.database
        .prepare('UPDATE library_items SET path = ?, item_id = ? WHERE library_id = ? AND path = ?')
        .run(to, itemId(to), libraryId, from);
      // A file nobody identified is its own work, named by its path, and sorts by it.
      const moved = this.get(libraryId, to);
      if (moved) {
        touched.add(workKeyOf(moved));
        this.database
          .prepare(
            'UPDATE library_items SET sort = ?, work_key = ? WHERE library_id = ? AND path = ?',
          )
          .run(sortOf(moved), workKeyOf(moved), libraryId, to);
      }
      this.regroup(libraryId, touched);
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
        hdr: row.hdr as Hdr | null,
        audioLanguages: languages(row.audio_languages),
        subtitleLanguages: languages(row.subtitle_languages),
        picture: row.picture,
        size: row.size ?? 0,
        mtime: row.mtime ?? 0,
        probedAt: row.probed_at,
      }
    );
  }

  /** What is known of these files, for those that were read: a list asks, it never probes. */
  probesOf(libraryId: string, paths: readonly string[]): Map<string, Probe> {
    const found = new Map<string, Probe>();
    for (const path of paths) {
      const known = this.probeOf(libraryId, path);
      if (known?.probedAt) {
        found.set(path, known);
      }
    }
    return found;
  }

  setProbe(libraryId: string, path: string, probe: Probe): void {
    this.changed(libraryId);
    this.database
      .prepare(
        `UPDATE library_items SET ${PROBE_ASSIGNMENTS}
         WHERE library_id = ? AND path = ?`,
      )
      .run(
        probe.video,
        probe.audio,
        probe.hdr,
        JSON.stringify(probe.audioLanguages),
        JSON.stringify(probe.subtitleLanguages),
        probe.picture,
        probe.size,
        probe.mtime,
        new Date().toISOString(),
        libraryId,
        path,
      );
  }

  /** Every row's path: what a refresh checks against the disk. */
  paths(libraryId: string): string[] {
    return this.database
      .prepare<[string], { path: string }>(
        'SELECT path FROM library_items WHERE library_id = ? ORDER BY path',
      )
      .all(libraryId)
      .map(({ path }) => path);
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
       VALUES (${WRITTEN_COLUMNS.split(', ')
         .map(() => '?')
         .join(', ')})
       ON CONFLICT (library_id, path) DO UPDATE SET ${WRITTEN_COLUMNS.split(', ')
         .slice(2)
         .map((column) => `${column} = excluded.${column}`)
         .join(', ')}`,
    );
  }

  put(item: LibraryItem): void {
    this.changed(item.libraryId);
    this.database.transaction(() => {
      // The row may change work (a movie matched to another film, a file settled): both are regrouped.
      const touched = this.workKeysAt(item.libraryId, ' AND path = ?', [item.path]);
      this.putStatement().run(...valuesOf(item));
      touched.add(workKeyOf(item));
      this.regroup(item.libraryId, touched);
    })();
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
    this.changed(libraryId);
    this.database.transaction(() => {
      for (const table of [
        'library_items',
        'series_completeness',
        'series_files',
        'collection_overrides',
      ]) {
        this.database.prepare(`DELETE FROM ${table} WHERE library_id = ?`).run(libraryId);
      }
    })();
  }

  remove(libraryId: string, path: string): void {
    this.changed(libraryId);
    this.database.transaction(() => {
      const touched = this.workKeysAt(libraryId, ' AND path = ?', [path]);
      this.database
        .prepare('DELETE FROM library_items WHERE library_id = ? AND path = ?')
        .run(libraryId, path);
      this.regroup(libraryId, touched);
    })();
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

  /**
   * One page of a library, by title (a file nobody recognized by its name), optionally filtered.
   * A movie is one entry whatever its versions (`works`: all the files of each, `items`: the
   * first), so paging and counting are in movies; the filters look at the files, and an entry
   * the filter reaches through one of its versions still shows all of them.
   */
  page(
    libraryId: string,
    options: {
      filter?: StateFilter;
      /** Only the works held in several versions; combines with `filter`. */
      multi?: boolean;
      collection?: CollectionFilter;
      sort?: ItemSort;
      dir?: SortDirection;
      query?: string;
      limit: number;
      offset: number;
    },
  ): { total: number; groups: number; items: LibraryItem[]; works: LibraryItem[][] } {
    const queryCondition =
      "(sort_key(title) LIKE ? ESCAPE '\\' OR sort_key(path) LIKE ? ESCAPE '\\')";
    // On the files (the groups of a validation) and on the lead row (the list): the collection is
    // the same for every file of a work, so the list asks it of the lead row rather than of "any
    // file of the work", which cost a pass over the collected rows for each work.
    const collection = options.collection
      ? collectionSql(options.collection, 'library_items')
      : undefined;
    const leadCollection = options.collection
      ? collectionSql(options.collection, 'lead_row')
      : undefined;
    const conditions = [
      ...(options.filter ? [FILTER_SQL[options.filter]] : []),
      ...(options.multi ? [FILTER_SQL['multi-version']] : []),
      ...(options.query ? [queryCondition] : []),
    ];
    const where = ['library_id = ?', ...(collection ? [collection.sql] : []), ...conditions].join(
      ' AND ',
    );
    const params: (string | number)[] = [
      libraryId,
      ...(collection?.params ?? []),
      ...(options.query
        ? [contains(sortKey(options.query)), contains(sortKey(options.query))]
        : []),
    ];
    // `where` over the files, for the groups of a validation; the list itself reads one row per work.
    const leads = leadWhere(conditions.join(' AND '), leadCollection?.sql);
    const order = itemOrder(options.sort ?? 'title', options.dir);
    const total =
      this.database
        .prepare<unknown[], { total: number }>(
          `SELECT COUNT(*) AS total FROM library_items AS lead_row WHERE ${leads}`,
        )
        .get(...params)?.total ?? 0;
    const groups = this.groupsWhere(where, params);
    const keys = this.database
      .prepare<unknown[], { key: string }>(
        `SELECT work_key AS key FROM library_items AS lead_row WHERE ${leads}
         ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(...params, options.limit, options.offset)
      .map(({ key }) => key);
    const rows = this.database
      .prepare<[string, string], Row & { key: string; lead: number; sort: string }>(
        `SELECT ${COLUMNS}, work_key AS key, lead, sort FROM library_items
         WHERE library_id = ? AND work_key IN (SELECT value FROM json_each(?))`,
      )
      .all(libraryId, JSON.stringify(keys))
      // The work's lead first (it is what the list shows), then its files as the list orders them:
      // sorted here, a few rows, rather than by SQLite with a temporary tree.
      .sort(
        (a, b) =>
          b.lead - a.lead ||
          (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : a.path < b.path ? -1 : 1),
      );
    const byKey = new Map<string, LibraryItem[]>();
    for (const row of rows) {
      byKey.set(row.key, [...(byKey.get(row.key) ?? []), toItem(row)]);
    }
    const works = keys.map((key) => byKey.get(key) ?? []).filter((work) => work.length > 0);
    return { total, groups, items: works.flatMap((work) => work.slice(0, 1)), works };
  }

  /**
   * The rows a condition keeps, counted as a validation settles them: the episodes of one release
   * and series are one group (`settleKey` in the web), anything else a group of its own.
   */
  private groupsWhere(where: string, params: readonly unknown[]): number {
    return (
      this.database
        .prepare<unknown[], { groups: number }>(
          `SELECT COUNT(DISTINCT CASE WHEN i.kind = 'series' AND e.release IS NOT NULL
                  THEN e.release || '|' || e.cluster ELSE i.path END) AS groups
           FROM (SELECT path, kind, entry_id FROM library_items WHERE ${where}) i
           LEFT JOIN job_entries e ON e.id = i.entry_id`,
        )
        .get(...params)?.groups ?? 0
    );
  }

  /** The effective collection of the rows at these paths, by path; a row in none is absent. */
  collectionsOf(libraryId: string, paths: readonly string[]): Map<string, RowCollection> {
    const rows = this.database
      .prepare<
        [string, string],
        { path: string; key: string; name: string; total: number | null; held: number }
      >(
        `SELECT path, collection_key AS key, collection_name AS name, collection_total AS total,
           ${heldOf('library_items')} AS held
         FROM library_items
         WHERE library_id = ? AND collection_key IS NOT NULL
           AND path IN (SELECT value FROM json_each(?))`,
      )
      .all(libraryId, JSON.stringify(paths));
    return new Map(rows.map((row) => [row.path, row]));
  }

  /** The movies (TMDB ids) of the library filed under a collection. */
  movieIdsIn(libraryId: string, collectionKey: string): Set<number> {
    return new Set(
      this.database
        .prepare<[string, string], { tmdb_id: number }>(
          `SELECT DISTINCT tmdb_id FROM library_items
           WHERE library_id = ? AND collection_key = ? AND tmdb_id IS NOT NULL`,
        )
        .all(libraryId, collectionKey)
        .map((row) => row.tmdb_id),
    );
  }

  /** What each collection filter holds (movies, not files), for the buttons of the page. */
  collectionCounts(libraryId: string): Record<'all' | 'in' | 'out' | 'incomplete', number> {
    const count = (filter?: CollectionFilter): number =>
      this.database
        .prepare<[string], { total: number }>(
          `SELECT COUNT(*) AS total FROM library_items AS lead_row
           WHERE ${leadWhere('', filter && collectionSql(filter, 'lead_row').sql)}`,
        )
        .get(libraryId)?.total ?? 0;
    return {
      all: count(),
      in: count('in'),
      out: count('out'),
      incomplete: count('incomplete'),
    };
  }

  /** What each filter holds, for the tabs of the page. */
  counts(libraryId: string, series = false): ItemCounts {
    // What the rows alone give is kept until they change; the rest reads other tables, which other
    // stores write (the files waiting for a person, the episodes a show lacks, the show's files).
    const counts = {
      ...this.memo(libraryId, series ? 'counts:series' : 'counts:movies', () =>
        this.countsOfRows(libraryId, series),
      ),
    };
    if (series) {
      // The files that wait for a person belong to no show (they are one node of the tree): the
      // tabs count them as that node does, a release once.
      for (const filter of ['review', 'unrecognized'] as const) {
        counts[filter] = this.groupsWhere(`library_id = ? AND ${FILTER_SQL[filter]}`, [libraryId]);
      }
    }
    // Counted in shows, not files: it is the list of shows that this filter narrows.
    counts['missing-episodes'] = this.countShows(libraryId, { missing: true });
    counts['missing-show-files'] = this.countShows(libraryId, { incomplete: true });
    return counts;
  }

  /** The counts that depend on `library_items` only (the two the files waiting for a person need are set apart). */
  private countsOfRows(libraryId: string, series: boolean): ItemCounts {
    const counts = { all: 0, 'missing-episodes': 0, 'missing-show-files': 0 } as ItemCounts;
    if (series) {
      // A series library reads as a tree of shows, so its tabs count shows.
      counts.all = this.countShows(libraryId, {});
      for (const filter of ITEM_FILTERS) {
        counts[filter] =
          filter === 'review' || filter === 'unrecognized'
            ? 0
            : filter === 'multi-version'
              ? this.countShows(libraryId, { multi: true })
              : this.countShows(libraryId, { state: filter });
      }
      counts['incomplete-versions'] = this.countShows(libraryId, { state: 'incomplete-versions' });
      return counts;
    }
    const count = (extra: string): number =>
      this.database
        .prepare<[string], { total: number }>(
          `SELECT COUNT(*) AS total FROM library_items AS lead_row WHERE ${leadWhere(extra)}`,
        )
        .get(libraryId)?.total ?? 0;
    counts.all = count('');
    for (const filter of ITEM_FILTERS) {
      counts[filter] = count(FILTER_SQL[filter]);
    }
    // Versions are a matter of shows: a movie is never short of one.
    counts['incomplete-versions'] = 0;
    return counts;
  }

  /**
   * The shows of a series library, one row each, by title. `missing` is what was last counted
   * (`null`: not yet, see `Completeness`). Files nobody identified (no work id) are not shows.
   */
  shows(
    libraryId: string,
    options: ShowFilter & {
      limit: number;
      offset: number;
      sort?: ShowSort;
      dir?: SortDirection;
    },
  ): { total: number; items: ShowRow[] } {
    const { grouped, params } = this.groupedShows(libraryId, options);
    const total = this.countShows(libraryId, options);
    const rows = this.database
      .prepare<unknown[], ShowQuery>(
        `${grouped} ORDER BY ${showOrder(options.sort ?? 'title', options.dir)} LIMIT ? OFFSET ?`,
      )
      .all(...params, options.limit, options.offset);
    // The episodes and versions are read from the files, once for the page: a range holds several
    // episodes and two versions hold one, which a count in SQL cannot tell.
    const held = this.ofShows(
      libraryId,
      rows.map((row) => row.tmdb_id),
    );
    return {
      total,
      items: rows.map((row) => {
        const files = held.get(row.tmdb_id) ?? [];
        const versionRows = files.map(versionRowOf);
        return {
          tmdbId: row.tmdb_id,
          title: row.title,
          year: row.year,
          seasons: row.seasons,
          episodes: distinctEpisodes(versionRows),
          versions: showCoverageOf(versionRows),
          missing: row.missing,
          rename: row.rename,
          refresh: row.refresh,
          nfo: flag(row.nfo),
          episodesLackingNfo: lackingNfo(files),
          poster: flag(row.poster),
          fanart: flag(row.fanart),
          logo: flag(row.logo),
          unavailable: unavailableOf(files),
        };
      }),
    };
  }

  /** The files of several shows of a series library, by show. */
  private ofShows(libraryId: string, tmdbIds: readonly number[]): Map<number, LibraryItem[]> {
    const rows = this.database
      .prepare<[string, string], Row>(
        `SELECT ${COLUMNS} FROM library_items
         WHERE library_id = ? AND kind = 'series' AND tmdb_id IN (SELECT value FROM json_each(?))
         ORDER BY path`,
      )
      .all(libraryId, JSON.stringify(tmdbIds))
      .map(toItem);
    const byShow = new Map<number, LibraryItem[]>();
    for (const item of rows) {
      if (item.tmdbId !== null) {
        byShow.set(item.tmdbId, [...(byShow.get(item.tmdbId) ?? []), item]);
      }
    }
    return byShow;
  }

  /**
   * The shows held in several versions, and those where a version lacks an episode another one
   * holds. Read from the files of the library: the sets are small, the rule is not SQL's.
   */
  private versionedShows(libraryId: string): { multi: number[]; incomplete: number[] } {
    return this.memo(libraryId, 'versioned', () => this.readVersionedShows(libraryId));
  }

  /**
   * Every write to a library's rows goes through this store, so a counter per library says whether
   * what was derived from them (the shows held in several versions, the counts) is still true. A
   * list reads those several times (the page, its total, the counts), and each costs a pass over
   * every row.
   */
  private changed(libraryId: string): void {
    this.generations.set(libraryId, (this.generations.get(libraryId) ?? 0) + 1);
  }

  private memo<T>(libraryId: string, key: string, compute: () => T): T {
    const generation = this.generations.get(libraryId) ?? 0;
    let entry = this.memoized.get(libraryId);
    if (entry?.generation !== generation) {
      entry = { generation, values: new Map() };
      this.memoized.set(libraryId, entry);
    }
    if (entry.values.has(key)) {
      return entry.values.get(key) as T;
    }
    const value = compute();
    // Searches make keys: a generation that sees many keeps the last ones, not all of them.
    if (entry.values.size >= 256) {
      entry.values.clear();
    }
    entry.values.set(key, value);
    return value;
  }

  private readVersionedShows(libraryId: string): { multi: number[]; incomplete: number[] } {
    const rows = this.database
      .prepare<[string], Row>(
        `SELECT ${COLUMNS} FROM library_items
         WHERE library_id = ? AND kind = 'series' AND tmdb_id IS NOT NULL`,
      )
      .all(libraryId)
      .map(toItem);
    const byShow = new Map<number, VersionRow[]>();
    for (const item of rows) {
      byShow.set(item.tmdbId ?? 0, [...(byShow.get(item.tmdbId ?? 0) ?? []), versionRowOf(item)]);
    }
    const shows = [...byShow];
    return {
      multi: shows.filter(([, files]) => hasSeveralVersions(files)).map(([id]) => id),
      incomplete: shows.filter(([, files]) => hasIncompleteVersion(files)).map(([id]) => id),
    };
  }

  /** The query of the shows, one row each, and its parameters. */
  private groupedShows(
    libraryId: string,
    options: ShowFilter,
  ): { grouped: string; params: (string | number)[] } {
    // The shows to keep by their versions: held in several, and/or with one lacking an episode.
    const sets =
      options.multi || options.state === 'incomplete-versions'
        ? this.versionedShows(libraryId)
        : undefined;
    const versioned: number[][] = [
      ...(options.multi && sets ? [sets.multi] : []),
      ...(options.state === 'incomplete-versions' && sets ? [sets.incomplete] : []),
    ];
    const where = [
      "i.library_id = ? AND i.kind = 'series' AND i.tmdb_id IS NOT NULL",
      ...(options.query ? ["sort_key(i.title) LIKE ? ESCAPE '\\'"] : []),
      ...versioned.map(() => 'i.tmdb_id IN (SELECT value FROM json_each(?))'),
      // The shows holding such a file, found once: a sub-query per row would walk every episode of
      // the show for each of them. The filter's columns are unqualified, so the inner table's.
      ...(options.state && options.state !== 'incomplete-versions'
        ? [
            `i.tmdb_id IN (SELECT x.tmdb_id FROM library_items x WHERE x.library_id = ?
               AND x.kind = 'series' AND x.tmdb_id IS NOT NULL AND ${FILTER_SQL[options.state]})`,
          ]
        : []),
    ].join(' AND ');
    // What is asked of a show as a whole (what its other tables say) is checked once per show, after
    // the episodes are grouped: joined to every episode first, it was a lookup per file, ~20 000 of them.
    const after = [
      ...(options.missing ? ['c.missing > 0'] : []),
      // A season's row only ever carries its poster, so one check covers the show and its seasons.
      ...(options.incomplete ? [LACKS_SHOW_FILES] : []),
    ];
    const params: (string | number)[] = [
      libraryId,
      ...(options.query ? [contains(sortKey(options.query))] : []),
      ...versioned.map((ids) => JSON.stringify(ids)),
      ...(options.state && options.state !== 'incomplete-versions' ? [libraryId] : []),
      libraryId,
      libraryId,
      ...(options.incomplete ? [libraryId] : []),
    ];
    const grouped = `
      SELECT s.tmdb_id AS tmdb_id, s.title AS title, s.year AS year, s.sort AS sort,
        s.seasons AS seasons, c.missing AS missing, s.rename AS rename, s.refresh AS refresh,
        f.nfo AS nfo, f.poster AS poster, f.fanart AS fanart, f.logo AS logo
      FROM (
        SELECT i.tmdb_id AS tmdb_id, MIN(i.title) AS title, MIN(i.year) AS year,
          MIN(i.sort) AS sort, COUNT(DISTINCT i.season) AS seasons,
          SUM(i.state = 'rename') AS rename, SUM(i.state = 'incomplete') AS refresh
        FROM library_items i
        WHERE ${where} GROUP BY i.tmdb_id
      ) s
      LEFT JOIN series_completeness c ON c.library_id = ? AND c.tmdb_id = s.tmdb_id
      LEFT JOIN series_files f ON f.library_id = ? AND f.tmdb_id = s.tmdb_id AND f.season = -1
      ${after.length > 0 ? `WHERE ${after.join(' AND ')}` : ''}`;
    return { grouped, params };
  }

  /** How many shows a filter keeps; the count alone, without reading a page of them. */
  private countShows(libraryId: string, options: ShowFilter): number {
    const wantsOtherTables = options.missing === true || options.incomplete === true;
    if (!wantsOtherTables) {
      // Only the rows say: the same count for every page of the list until a row changes.
      const key = `shows:${JSON.stringify([options.query, options.state, options.multi])}`;
      return this.memo(libraryId, key, () => this.countGrouped(libraryId, options));
    }
    if (!options.query && !options.state && !options.multi) {
      // Which shows exist is the rows' (kept); what each lacks is read from its own table, for those
      // only: grouping the episodes again to count shows would read every one of them.
      const ids = JSON.stringify(this.showIds(libraryId));
      const lacking = options.missing
        ? this.database
            .prepare<[string, string], { total: number }>(
              `SELECT COUNT(*) AS total FROM series_completeness c
               WHERE c.library_id = ? AND c.missing > 0
                 AND c.tmdb_id IN (SELECT value FROM json_each(?))`,
            )
            .get(libraryId, ids)
        : undefined;
      if (options.missing && !options.incomplete) {
        return lacking?.total ?? 0;
      }
      if (options.incomplete && !options.missing) {
        return (
          this.database
            .prepare<[string, string], { total: number }>(
              `SELECT COUNT(*) AS total FROM (SELECT value AS tmdb_id FROM json_each(?)) s
               WHERE ${LACKS_SHOW_FILES}`,
            )
            .get(ids, libraryId)?.total ?? 0
        );
      }
    }
    return this.countGrouped(libraryId, options);
  }

  /** The shows of a library (a TMDB id each), as its rows hold them. */
  private showIds(libraryId: string): number[] {
    return this.memo(libraryId, 'show-ids', () =>
      this.database
        .prepare<[string], { tmdb_id: number }>(
          `SELECT DISTINCT tmdb_id FROM library_items
           WHERE library_id = ? AND kind = 'series' AND tmdb_id IS NOT NULL`,
        )
        .all(libraryId)
        .map((row) => row.tmdb_id),
    );
  }

  private countGrouped(libraryId: string, options: ShowFilter): number {
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

/**
 * A file the library holds as what it is: not waiting for a person. The tmdb id of a file to
 * validate is only the matcher's guess (a conflict keeps the candidate it chose, which may be
 * another film), so it must never make that file a version of the film it was mistaken for.
 */
const SETTLED = "state NOT IN ('review', 'unrecognized')";

/** `SETTLED` for the other row of a self-join. */
const SETTLED_OTHER = "other.state NOT IN ('review', 'unrecognized')";

/** Whether a file waits for a person to decide what it is. */
export const isUnsettled = (item: Pick<LibraryItem, 'state'>): boolean =>
  item.state === 'review' || item.state === 'unrecognized';

interface KeyRow {
  path: string;
  kind: 'movie' | 'series' | null;
  tmdb_id: number | null;
  title: string | null;
  state: ItemState;
}

const keyedItem = (
  row: KeyRow,
): Pick<LibraryItem, 'path' | 'kind' | 'tmdbId' | 'title' | 'state'> => ({
  path: row.path,
  kind: row.kind,
  tmdbId: row.tmdb_id,
  title: row.title,
  state: row.state,
});

/**
 * What makes one entry of a list: a movie the library identified is one whatever its versions,
 * anything else (a file nobody identified, an episode) is its own file. Stored in `work_key`,
 * written with the row (the same rule as `SETTLED`).
 */
const workKeyOf = (item: Pick<LibraryItem, 'path' | 'kind' | 'tmdbId' | 'state'>): string =>
  item.kind === 'movie' && item.tmdbId !== null && !isUnsettled(item)
    ? `m${String(item.tmdbId)}`
    : item.path;

/** What a list orders by: the title, or the path of a file nobody identified. */
const sortOf = (item: Pick<LibraryItem, 'path' | 'title'>): string =>
  sortKey(item.title ?? item.path);

/**
 * The condition of a list read on the first file of each work (`lead_row`). A filter keeps the
 * work when **any** of its files matches it, hence the `EXISTS` over the work: the inner table is
 * not aliased, since `FILTER_SQL` names `library_items`.
 */
const leadWhere = (rowFilter: string, leadFilter?: string): string =>
  `library_id = ? AND lead = 1${leadFilter ? ` AND ${leadFilter}` : ''}${
    rowFilter
      ? ` AND EXISTS (SELECT 1 FROM library_items
           WHERE library_items.library_id = lead_row.library_id
             AND library_items.work_key = lead_row.work_key AND ${rowFilter})`
      : ''
  }`;

/** How a list is ordered: by title (the default), by collection, or by year. */
export const ITEM_SORTS = ['title', 'collection', 'year'] as const;
export type ItemSort = (typeof ITEM_SORTS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** A column's first click: Title and Collection read upwards, Year and Missing the largest first. */
export const DEFAULT_DIRECTION: Record<ItemSort | ShowSort, SortDirection> = {
  title: 'asc',
  collection: 'asc',
  year: 'desc',
  missing: 'desc',
};

const SQL_DIRECTION: Record<SortDirection, string> = { asc: 'ASC', desc: 'DESC' };

// A collection's groups follow its name (the direction turns them over), a group's movies their
// year; movies in none come last either way. A movie with no year comes last in a year order.
const itemOrder = (sort: ItemSort, direction?: SortDirection): string => {
  const dir = SQL_DIRECTION[direction ?? DEFAULT_DIRECTION[sort]];
  switch (sort) {
    case 'title':
      return `sort ${dir}, path ${dir}`;
    case 'year':
      return `year IS NULL, year ${dir}, sort, path`;
    case 'collection':
      return `collection_key IS NULL, sort_key(collection_name) ${dir}, collection_key, year IS NULL, year, sort, path`;
  }
};

/** How the shows are ordered: by title, year, or what they lack (a show not counted yet comes last). */
export const SHOW_SORTS = ['title', 'year', 'missing'] as const;
export type ShowSort = (typeof SHOW_SORTS)[number];

const showOrder = (sort: ShowSort, direction?: SortDirection): string => {
  const dir = SQL_DIRECTION[direction ?? DEFAULT_DIRECTION[sort]];
  switch (sort) {
    case 'title':
      return `sort ${dir}, tmdb_id`;
    case 'year':
      return `year IS NULL, year ${dir}, sort, tmdb_id`;
    case 'missing':
      return `missing IS NULL, missing ${dir}, sort, tmdb_id`;
  }
};

/** The movies of the row's collection that the library holds (a movie once, whatever its versions). */
// `outer` is how the row asking is named where this is used (`lead_row` in a list). The index is forced:
// with its columns in the index of the works, SQLite counts from that one, which has no collection
// to seek and so reads the whole library for every row it is asked about.
const heldOf = (outer: string): string =>
  `(SELECT COUNT(DISTINCT held.work_key) FROM library_items held INDEXED BY library_items_collection
  WHERE held.library_id = ${outer}.library_id
    AND held.collection_key = ${outer}.collection_key)`;

/**
 * What narrows a list by collection: movies in one, in none, in one the library holds only a
 * part of, or in a given one (`t:<id>` for the provider's, `c:<name>` for the owner's).
 */
export type CollectionFilter = 'in' | 'out' | 'incomplete' | { readonly key: string };

const collectionSql = (
  filter: CollectionFilter,
  outer: string,
): { sql: string; params: string[] } =>
  filter === 'in'
    ? { sql: 'collection_key IS NOT NULL', params: [] }
    : filter === 'out'
      ? { sql: 'collection_key IS NULL', params: [] }
      : filter === 'incomplete'
        ? {
            sql: `(collection_total IS NOT NULL AND collection_total > ${heldOf(outer)})`,
            params: [],
          }
        : { sql: 'collection_key = ?', params: [filter.key] };

/** A movie's effective collection, with how much of it the library holds. */
export interface RowCollection {
  readonly key: string;
  readonly name: string;
  /** The provider's count of its movies; `null` for the owner's own collection (nothing to count). */
  readonly total: number | null;
  /** Movies of it in the library. */
  readonly held: number;
}

/** The views of a library: a state, or a kind of file that is missing. */
export const ITEM_FILTERS = [
  'review',
  'rename',
  'unrecognized',
  'missing-nfo',
  'missing-artwork',
  'multi-version',
] as const;
export type ItemFilter = (typeof ITEM_FILTERS)[number];

/**
 * The states a list is narrowed to. "Several versions" is no state but a trait that combines with
 * one (`multi`), so it is not among them.
 */
export const STATE_FILTERS = ITEM_FILTERS.filter(
  (filter): filter is Exclude<ItemFilter, 'multi-version'> => filter !== 'multi-version',
);
export type StateFilter = (typeof STATE_FILTERS)[number];

/** What narrows the shows of a series library: those of the items, and the versions that lack. */
export const SHOW_FILTERS = [...STATE_FILTERS, 'incomplete-versions'] as const;
export type ShowStateFilter = (typeof SHOW_FILTERS)[number];

const FILTER_SQL: Record<ItemFilter, string> = {
  review: "state = 'review'",
  rename: "state = 'rename'",
  unrecognized: "state = 'unrecognized'",
  'missing-nfo': 'nfo = 0',
  'missing-artwork': '(poster = 0 OR fanart = 0 OR logo = 0 OR thumb = 0)',
  // Another file holds the same work (and episode): a version of it.
  'multi-version': `${SETTLED} AND EXISTS (SELECT 1 FROM library_items other
    WHERE ${SETTLED_OTHER} AND other.library_id = library_items.library_id AND other.path <> library_items.path
      AND other.kind = library_items.kind AND other.tmdb_id = library_items.tmdb_id
      AND other.season IS library_items.season AND other.episode IS library_items.episode)`,
};

export type ItemCounts = Record<
  ItemFilter | 'all' | 'missing-episodes' | 'missing-show-files' | 'incomplete-versions',
  number
>;

/** A show of a series library, with what its files make of it. */
export interface ShowRow {
  readonly tmdbId: number;
  readonly title: string | null;
  readonly year: number | null;
  readonly seasons: number;
  /** The distinct episodes the files hold: two versions of one are one. */
  readonly episodes: number;
  /** Each version the files make of them, with how many episodes it holds of the total. */
  readonly versions: readonly VersionCoverage[];
  /** Episodes with a file lacking its NFO (any of their versions). */
  readonly episodesLackingNfo: number;
  /** Aired episodes no file holds, as last counted; `null` until it was. */
  readonly missing: number | null;
  /** Episodes whose video is to rename, and those lacking an NFO or image: what "Rename" and "Refresh" take. */
  readonly rename: number;
  readonly refresh: number;
  /** The show's own files (`tvshow.nfo`, poster, fanart); `null`: not written, or not looked at. */
  readonly nfo: Presence;
  readonly poster: Presence;
  readonly fanart: Presence;
  readonly logo: Presence;
  /** Show images the profile writes that TMDB has none of: not missing, whatever the disk says. */
  readonly unavailable: readonly UnavailableImage[];
}

/** What TMDB lacks for a work, as every one of its files was planned (they share the show's folder). */
const unavailableOf = (files: readonly LibraryItem[]): UnavailableImage[] => [
  ...new Set(files.flatMap((file) => file.unavailable)),
];

/**
 * SQL, inside the sub-query on `series_files m`: true when none of the show's files was planned
 * knowing TMDB has no such image (the file is then not missing, nobody can write it).
 */
const unavailableSql = (kind: UnavailableImage): string =>
  `NOT EXISTS (SELECT 1 FROM library_items u, json_each(u.unavailable) j
     WHERE u.library_id = m.library_id AND u.tmdb_id = m.tmdb_id AND u.kind = 'series'
       AND j.value = '${kind}')`;

/** For a row `s` holding a show's `tmdb_id` (one `?`: the library): it lacks a file the profile writes. */
const LACKS_SHOW_FILES = `EXISTS (SELECT 1 FROM series_files m WHERE m.library_id = ?
  AND m.tmdb_id = s.tmdb_id AND (m.nfo = 0
    OR (m.poster = 0 AND ${unavailableSql('poster')})
    OR (m.fanart = 0 AND ${unavailableSql('fanart')})
    OR (m.logo = 0 AND ${unavailableSql('logo')})))`;

interface ShowQuery {
  tmdb_id: number;
  title: string | null;
  year: number | null;
  seasons: number;
  missing: number | null;
  rename: number;
  refresh: number;
  nfo: number | null;
  poster: number | null;
  fanart: number | null;
  logo: number | null;
}

/** What a row says of its episodes and its version. */
export const versionRowOf = (item: LibraryItem): VersionRow => ({
  season: item.season,
  episode: item.episode,
  episodeEnd: item.episodeEnd,
  resolution: resolutionOfItem(item),
});

/** The episodes with at least one file whose NFO is missing: a range is one file, so one episode. */
export function lackingNfo(files: readonly LibraryItem[]): number {
  return new Set(
    files
      .filter((item) => item.nfo === false && item.season !== null && item.episode !== null)
      .map((item) => `${String(item.season)}:${String(item.episode)}`),
  ).size;
}

/** Lower case without accents: what titles are ordered and searched by (`sort_key` in SQL). */
const sortKey = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** A LIKE pattern that matches the text itself, `%` and `_` included. */
const contains = (text: string): string => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

type Writable = CompanionKind;

/** Which files the profile writes for a work of this kind (none for a file nobody identified). */
const writes = (profile: Profile, kind: 'movie' | 'series' | null): Record<Writable, boolean> =>
  kind === null
    ? { nfo: false, poster: false, fanart: false, logo: false, thumb: false }
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
  const none = { nfo: null, poster: null, fanart: null, logo: null, thumb: null };
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
  const result = {
    nfo: presence('nfo'),
    poster: presence('poster'),
    fanart: presence('fanart'),
    logo: presence('logo'),
    thumb: presence('thumb'),
  };
  // A video already in place only carries what is missing: the files of its show and of its
  // seasons' posters go with its first episode, and belong to no flag above. Anything still to
  // write beside it makes it incomplete, or a show lacking only those could not be refreshed.
  const pending = item.operations.some((operation) => !isTransfer(operation));
  const state: ItemState = moves
    ? 'rename'
    : pending || Object.values(result).some((value) => value === false)
      ? 'incomplete'
      : 'ok';
  // A movie to rename has all of its files still to come: they are not there to be missing.
  return { state, ...result };
}

/** What a profile writes for a library of this type, which drives the columns of its page. */
export function profileWrites(
  profile: Profile,
  type: 'movie' | 'series',
): { nfo: boolean; artwork: boolean; logo: boolean; thumb: boolean } {
  if (type === 'series') {
    return {
      nfo: profile.nfo !== null,
      artwork: profile.artwork.some(({ kind }) => kind === 'poster' || kind === 'fanart'),
      logo: profile.artwork.some(({ kind }) => kind === 'logo'),
      thumb: profile.artwork.some(({ kind }) => kind === 'episode-thumb'),
    };
  }
  const wanted = writes(profile, 'movie');
  return {
    nfo: wanted.nfo,
    artwork: wanted.poster || wanted.fanart,
    logo: wanted.logo,
    thumb: false,
  };
}

/** The picture size a release name announces (`2160p`, `4K`…), the one cheap thing it says of the video. */
export function resolutionOf(path: string): string | null {
  const match = /(?<![a-z0-9])(2160p|1440p|1080p|720p|576p|480p|4k|uhd)(?![a-z0-9])/i.exec(
    basename(path),
  );
  const found = match?.[1]?.toLowerCase();
  return found === undefined ? null : found === '4k' || found === 'uhd' ? '2160p' : found;
}

/** The picture size of a file: its name's when it gives one, else what the probe read of it. */
export const resolutionOfItem = (item: Pick<LibraryItem, 'path' | 'picture'>): string | null =>
  resolutionOf(item.path) ?? item.picture;

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
    unavailable: entry.item?.unavailable ?? [],
    entryId: entry.id,
    scanJobId: entry.jobId,
    scannedAt,
    // Only the probe writes it (the row keeps its own when patched).
    picture: null,
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

/**
 * The versions of a movie share its folder's `movie.nfo` and images, and a plan writes each of
 * them once, on the first version of its batch: the others find them taken and look complete.
 * A file shared is there for all of them or for none, so one missing makes it missing everywhere.
 */
export function shareMovieFiles(items: readonly LibraryItem[]): LibraryItem[] {
  const folders = new Map<string, LibraryItem[]>();
  for (const item of items) {
    if (item.kind === 'movie' && item.tmdbId !== null) {
      const key = `${dirname(item.path)}|${String(item.tmdbId)}`;
      folders.set(key, [...(folders.get(key) ?? []), item]);
    }
  }
  const lacking = (versions: readonly LibraryItem[], name: Writable): boolean =>
    versions.some((version) => version[name] === false);
  return items.map((item) => {
    const versions =
      item.kind === 'movie' && item.tmdbId !== null
        ? folders.get(`${dirname(item.path)}|${String(item.tmdbId)}`)
        : undefined;
    if (!versions || versions.length < 2) {
      return item;
    }
    const share = (name: Writable): Presence =>
      item[name] !== null && lacking(versions, name) ? false : item[name];
    const next = {
      nfo: share('nfo'),
      poster: share('poster'),
      fanart: share('fanart'),
      logo: share('logo'),
      thumb: share('thumb'),
    };
    // A file that now lacks something is to complete, unless the video itself is to rename.
    return {
      ...item,
      ...next,
      state:
        item.state === 'ok' && Object.values(next).some((value) => value === false)
          ? 'incomplete'
          : item.state,
    };
  });
}

/** The typed library a file sits in, if any. */
const typedLibraryHolding = (config: Config, path: string): LibraryConfig | undefined =>
  config.libraries?.find(
    ({ type, source }) => type !== undefined && path !== source && isInside(path, source),
  );

/**
 * The profile of each typed library, read once per call rather than once per file: a batch or an
 * undo of a whole series goes through thousands of them.
 */
function profilesOf(config: Config): (library: LibraryConfig) => Profile {
  const profiles = new Map<string, Profile>();
  return (library) => {
    const profile = profiles.get(library.id) ?? buildProfile(libraryProfile(library, config));
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

  /** The typed library a job scanned, in full or one folder of it, if it is one. */
  private libraryOf(job: Job | undefined): LibraryConfig | undefined {
    const library = this.deps.config().libraries?.find(({ id }) => id === job?.libraryId);
    if (library?.type === undefined || job === undefined) {
      return undefined;
    }
    return library.source === job.path || (job.rescan && isInside(job.path, library.source))
      ? library
      : undefined;
  }

  private profileOf(jobId: string): Profile | undefined {
    const settings = this.deps.jobs.settings(jobId);
    return settings && buildProfile(settings.profile);
  }

  /** A scan of a library's whole source, or of one folder of it, is done. */
  scanned(job: Job): void {
    const library = this.libraryOf(job);
    const profile = this.profileOf(job.id);
    if (!library || !profile) {
      return;
    }
    const now = new Date().toISOString();
    this.deps.store.replace(
      library.id,
      shareMovieFiles(
        this.deps.entries.mapList(job.id, (entry) => itemOf(entry, profile, library.id, now)),
      ),
      job.path === library.source ? undefined : job.path,
    );
    this.deps.changed?.(library.id);
  }

  /** A human chose the work of a file: its row follows, with the title they chose. */
  matched(entry: Entry, candidate: Candidate): void {
    const job = this.deps.jobs.get(entry.jobId);
    const library = this.libraryOf(job);
    const profile = this.profileOf(entry.jobId);
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
  transferred(
    jobId: string,
    done: readonly { readonly entry: Entry; readonly results: readonly OperationResult[] }[],
  ): void {
    const library = this.libraryOf(this.deps.jobs.get(jobId));
    const profile = this.profileOf(jobId);
    if (!library || !profile) {
      this.arrived(done);
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
  private arrived(
    done: readonly { readonly entry: Entry; readonly results: readonly OperationResult[] }[],
  ): void {
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
      const profile = profileOf(library);
      const row = itemOf(entry, profile, library.id, now);
      const failed = new Set<Writable>(
        results
          .filter((r) => r.operation.type !== 'transfer' && r.status === 'failed')
          .flatMap((r) => fileKind(profile, r.operation.destination) ?? []),
      );
      // Everything the plan wrote is there now, unless it failed; the video itself was moved.
      const present = (name: Writable): Presence => (row[name] === null ? null : !failed.has(name));
      const next = {
        nfo: present('nfo'),
        poster: present('poster'),
        fanart: present('fanart'),
        logo: present('logo'),
        thumb: present('thumb'),
      };
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
  undone(entries: readonly JournalEntry[]): void {
    const config = this.deps.config();
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
      // A replaced image is back as it was, still there: only a new one is gone.
      if (entry.kind !== 'replaced') {
        this.mark(library, entry.destination, 'gone');
      }
    }
  }

  /** An image was put beside a video by hand (a replacement): the rows next to it have it. */
  written(destination: string): void {
    const library = typedLibraryHolding(this.deps.config(), destination);
    if (library) {
      this.mark(library, destination, 'present');
    }
  }

  private mark(library: LibraryConfig, destination: string, change: 'present' | 'gone'): void {
    const kind = fileKind(profilesOf(this.deps.config())(library), destination);
    if (kind === undefined) {
      return;
    }
    for (const row of beside(
      this.deps.store.inFolder(library.id, dirname(destination)),
      destination,
    )) {
      this.settle(row, row.path, new Set<Writable>([kind]), change);
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
    const next = {
      nfo: apply('nfo'),
      poster: apply('poster'),
      fanart: apply('fanart'),
      logo: apply('logo'),
      thumb: apply('thumb'),
    };
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
