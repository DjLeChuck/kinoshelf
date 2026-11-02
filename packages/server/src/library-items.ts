import { createHash } from 'node:crypto';
import { basename, dirname } from 'node:path';
import {
  loadProfile,
  type Candidate,
  type Config,
  type JournalEntry,
  type LibraryConfig,
  type Operation,
  type OperationResult,
  type Profile,
} from '@kinoshelf/core';
import type { Database } from 'better-sqlite3';
import type { Entry, EntryStore } from './entries.js';
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
  state: ItemState;
  nfo: number | null;
  poster: number | null;
  fanart: number | null;
  entry_id: string | null;
  scan_job_id: string | null;
  scanned_at: string;
}

const COLUMNS =
  'library_id, path, kind, tmdb_id, title, year, state, nfo, poster, fanart, entry_id, scan_job_id, scanned_at';

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

const toItem = (row: Row): LibraryItem => ({
  libraryId: row.library_id,
  path: row.path,
  kind: row.kind,
  tmdbId: row.tmdb_id,
  title: row.title,
  year: row.year,
  state: row.state,
  nfo: flag(row.nfo),
  poster: flag(row.poster),
  fanart: flag(row.fanart),
  entryId: row.entry_id,
  scanJobId: row.scan_job_id,
  scannedAt: row.scanned_at,
});

/** What a library holds, in the database: a snapshot, not a second source of truth for the disk. */
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
      for (const item of items) {
        this.put(item);
        const probe = kept.get(item.path);
        if (probe?.probed_at) {
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
        .prepare('UPDATE library_items SET path = ? WHERE library_id = ? AND path = ?')
        .run(to, libraryId, from);
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

  put(item: LibraryItem): void {
    this.database
      .prepare(
        // An upsert, not a replacement: what ffprobe learned of the file is not the scan's to erase.
        `INSERT INTO library_items (${COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (library_id, path) DO UPDATE SET ${COLUMNS.split(', ')
           .slice(2)
           .map((column) => `${column} = excluded.${column}`)
           .join(', ')}`,
      )
      .run(
        item.libraryId,
        item.path,
        item.kind,
        item.tmdbId,
        item.title,
        item.year,
        item.state,
        bit(item.nfo),
        bit(item.poster),
        bit(item.fanart),
        item.entryId,
        item.scanJobId,
        item.scannedAt,
      );
  }

  get(libraryId: string, path: string): LibraryItem | undefined {
    const row = this.database
      .prepare<[string, string], Row>(
        `SELECT ${COLUMNS} FROM library_items WHERE library_id = ? AND path = ?`,
      )
      .get(libraryId, path);
    return row && toItem(row);
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
    return counts;
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
    return this.all(libraryId).filter((item) => dirname(item.path) === folder);
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

export type ItemCounts = Record<ItemFilter | 'all', number>;

/** A LIKE pattern that matches the text itself, `%` and `_` included. */
const contains = (text: string): string => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

type Writable = 'nfo' | 'poster' | 'fanart';

/**
 * Which files the profile writes for a work of this kind. A movie written flat (no folder) gets no
 * fixed-name file (`poster.jpg` would be every movie's); series are left to their own step.
 */
export function writes(
  profile: Profile,
  kind: 'movie' | 'series' | null,
): Record<Writable, boolean> {
  if (kind !== 'movie') {
    return { nfo: false, poster: false, fanart: false };
  }
  const foldered = profile.templates.movieFolder !== '';
  return {
    nfo: profile.nfo !== null && (foldered || profile.nfo.movie.includes('{file}')),
    poster: foldered && profile.artwork.some((spec) => spec.kind === 'poster'),
    fanart: foldered && profile.artwork.some((spec) => spec.kind === 'fanart'),
  };
}

/** What an NFO or image path is, according to the profile; `undefined` for any other file. */
function fileKind(profile: Profile, destination: string): Writable | undefined {
  const name = basename(destination);
  if (profile.nfo !== null && name.endsWith('.nfo')) {
    return 'nfo';
  }
  const spec = profile.artwork.find((candidate) => candidate.name === name);
  return spec?.kind === 'poster' || spec?.kind === 'fanart' ? spec.kind : undefined;
}

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

const kindOf = (entry: Pick<Entry, 'parsed'>): 'movie' | 'series' | null =>
  entry.parsed.kind === 'movie' ? 'movie' : entry.parsed.kind === 'episode' ? 'series' : null;

/** The row for a file of a scan, from the entry the scan stored for it. */
export function itemOf(
  entry: Entry,
  profile: Profile,
  libraryId: string,
  scannedAt: string,
  matched?: Candidate,
): LibraryItem {
  const kind = kindOf(entry);
  const best = matched ?? (entry.item ? entry.candidates[0] : undefined);
  return {
    libraryId,
    path: entry.path,
    kind,
    tmdbId: entry.item?.externalId.id ?? null,
    title: best?.title ?? entry.parsed.title ?? null,
    year: best?.year ?? entry.parsed.year ?? null,
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
export class LibrarySnapshot {
  constructor(
    private readonly deps: {
      readonly config: () => Config;
      readonly jobs: JobStore;
      readonly entries: EntryStore;
      readonly store: LibraryItemStore;
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
    const entries = this.deps.entries.list(job.id, { limit: Number.MAX_SAFE_INTEGER, offset: 0 });
    this.deps.store.replace(
      library.id,
      entries.map((entry) => itemOf(entry, profile, library.id, now)),
    );
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
  }

  /** Transfers of a job ended: each video that went through is where it was sent, and written. */
  async transferred(
    jobId: string,
    done: readonly { readonly entry: Entry; readonly results: readonly OperationResult[] }[],
  ): Promise<void> {
    const library = this.libraryOf(this.deps.jobs.get(jobId));
    const profile = await this.profileOf(jobId);
    if (!library || !profile) {
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
   * A batch was undone: a video is back where it came from, and the files written beside the
   * others are gone. Files that sit in no typed library are not ours to track.
   */
  async undone(entries: readonly JournalEntry[]): Promise<void> {
    const config = this.deps.config();
    // The written files first: once a video is moved back, its folder is no longer the one to look in.
    const ordered = [...entries].sort(
      (a, b) => Number(a.kind === 'transfer') - Number(b.kind === 'transfer'),
    );
    for (const entry of ordered) {
      const library = config.libraries?.find(
        ({ type, source }) => type !== undefined && entry.destination.startsWith(`${source}/`),
      );
      if (!library) {
        continue;
      }
      if (entry.kind === 'transfer') {
        const row = this.deps.store.get(library.id, entry.destination);
        if (row) {
          this.settle(row, entry.source, new Set(), 'gone');
        }
        continue;
      }
      const profile = await loadProfile(library.profile ?? config.profile ?? 'plex');
      const kind = fileKind(profile, entry.destination);
      if (kind === undefined) {
        continue;
      }
      for (const row of this.deps.store.inFolder(library.id, dirname(entry.destination))) {
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
  }
}
