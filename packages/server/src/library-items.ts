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
import type { Database, Statement } from 'better-sqlite3';
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
  /** An episode's own image, `<file>.jpg`. */
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
}

export class LibraryItemStore {
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
    this.database.transaction(() => {
      for (const table of ['library_items', 'series_completeness', 'series_files']) {
        this.database.prepare(`DELETE FROM ${table} WHERE library_id = ?`).run(libraryId);
      }
    })();
  }

  remove(libraryId: string, path: string): void {
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
    options: { filter?: ItemFilter; query?: string; limit: number; offset: number },
  ): { total: number; groups: number; items: LibraryItem[]; works: LibraryItem[][] } {
    const where = [
      'library_id = ?',
      ...(options.filter ? [FILTER_SQL[options.filter]] : []),
      ...(options.query
        ? ["(sort_key(title) LIKE ? ESCAPE '\\' OR sort_key(path) LIKE ? ESCAPE '\\')"]
        : []),
    ].join(' AND ');
    const queryParams = options.query
      ? [contains(sortKey(options.query)), contains(sortKey(options.query))]
      : [];
    const params: (string | number)[] = [libraryId, ...queryParams];
    // `where` over the files, for the groups of a validation; the list itself reads one row per work.
    const leads = leadWhere(
      [
        ...(options.filter ? [FILTER_SQL[options.filter]] : []),
        ...(options.query
          ? ["(sort_key(title) LIKE ? ESCAPE '\\' OR sort_key(path) LIKE ? ESCAPE '\\')"]
          : []),
      ].join(' AND '),
    );
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
         ORDER BY sort, path LIMIT ? OFFSET ?`,
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

  /** What each filter holds, for the tabs of the page. */
  counts(libraryId: string, series = false): ItemCounts {
    const counts = { all: 0 } as ItemCounts;
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
    if (series) {
      // A series library reads as a tree of shows, so its tabs count shows. The files that wait
      // for a person belong to no show (they are one node of the tree): the tabs count them as
      // that node does, a release once.
      counts.all = this.countShows(libraryId, {});
      for (const filter of ITEM_FILTERS) {
        counts[filter] =
          filter === 'review' || filter === 'unrecognized'
            ? this.groupsWhere(`library_id = ? AND ${FILTER_SQL[filter]}`, [libraryId])
            : this.countShows(libraryId, { state: filter });
      }
    }
    // Counted in shows, not files: it is the list of shows that this filter narrows.
    counts['missing-episodes'] = this.countShows(libraryId, { missing: true });
    counts['missing-show-files'] = this.countShows(libraryId, { incomplete: true });
    // Versions are a matter of shows: a movie is never short of one.
    counts['incomplete-versions'] = series
      ? this.countShows(libraryId, { state: 'incomplete-versions' })
      : 0;
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
      .prepare<unknown[], ShowQuery>(`${grouped} ORDER BY sort, tmdb_id LIMIT ? OFFSET ?`)
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
    const where = [
      "i.library_id = ? AND i.kind = 'series' AND i.tmdb_id IS NOT NULL",
      ...(options.query ? ["sort_key(i.title) LIKE ? ESCAPE '\\'"] : []),
      ...(options.state === 'multi-version' || options.state === 'incomplete-versions'
        ? ['i.tmdb_id IN (SELECT value FROM json_each(?))']
        : []),
      // The filter's columns are unqualified: inside the sub-query they are the inner table's.
      ...(options.state &&
      options.state !== 'multi-version' &&
      options.state !== 'incomplete-versions'
        ? [
            `EXISTS (SELECT 1 FROM library_items x WHERE x.library_id = i.library_id
               AND x.tmdb_id = i.tmdb_id AND x.kind = 'series' AND ${FILTER_SQL[options.state]})`,
          ]
        : []),
      // A season's row only ever carries its poster, so one check covers the show and its seasons.
      ...(options.incomplete
        ? [
            `EXISTS (SELECT 1 FROM series_files m WHERE m.library_id = i.library_id
               AND m.tmdb_id = i.tmdb_id AND (m.nfo = 0
                 OR (m.poster = 0 AND ${unavailableSql('poster')})
                 OR (m.fanart = 0 AND ${unavailableSql('fanart')})
                 OR (m.logo = 0 AND ${unavailableSql('logo')})))`,
          ]
        : []),
    ].join(' AND ');
    const having = options.missing ? 'HAVING MAX(c.missing) > 0' : '';
    const params: (string | number)[] = [
      libraryId,
      ...(options.query ? [contains(sortKey(options.query))] : []),
      ...(options.state === 'multi-version' || options.state === 'incomplete-versions'
        ? [
            JSON.stringify(
              this.versionedShows(libraryId)[
                options.state === 'multi-version' ? 'multi' : 'incomplete'
              ],
            ),
          ]
        : []),
    ];
    const grouped = `
      SELECT i.tmdb_id AS tmdb_id, MIN(i.title) AS title, MIN(i.year) AS year, MIN(i.sort) AS sort,
        COUNT(DISTINCT i.season) AS seasons,
        MAX(c.missing) AS missing,
        SUM(i.state = 'rename') AS rename, SUM(i.state = 'incomplete') AS refresh,
        MAX(f.nfo) AS nfo, MAX(f.poster) AS poster, MAX(f.fanart) AS fanart,
        MAX(f.logo) AS logo
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
const leadWhere = (rowFilter: string): string =>
  `library_id = ? AND lead = 1${
    rowFilter
      ? ` AND EXISTS (SELECT 1 FROM library_items
           WHERE library_items.library_id = lead_row.library_id
             AND library_items.work_key = lead_row.work_key AND ${rowFilter})`
      : ''
  }`;

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

/** What narrows the shows of a series library: those of the items, and the versions that lack. */
export const SHOW_FILTERS = [...ITEM_FILTERS, 'incomplete-versions'] as const;
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
