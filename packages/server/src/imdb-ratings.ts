import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import type { Database, MetadataProvider, Rating } from '@kinoshelf/core';
import type { MatchFailure } from './matches.js';
import { failureOf } from './matches.js';

/** IMDb's public dataset of ratings, for personal and non-commercial use. */
export const IMDB_RATINGS_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz';

/** The dataset changes daily: asking more often would only cost IMDb bandwidth. */
const MAX_AGE_MS = 24 * 3_600_000;
/** After a failure, wait before trying again, so a setting saved twice does not hammer the host. */
const RETRY_MS = 10 * 60_000;
/** Rows written per transaction: the event loop gets its turn between two. */
const BATCH = 20_000;

export interface ImdbTask {
  status: 'running' | 'done' | 'failed';
  /** Rows written so far; the file does not say how many there are, so there is no total. */
  done: number;
  startedAt: string;
  endedAt: string | null;
  error: MatchFailure | null;
}

export interface ImdbLog {
  info(data: object, message: string): void;
  warn(data: object, message: string): void;
}

/**
 * IMDb's ratings, read from its daily dataset. **Opt-in** (`imdbRatings` in the settings): this
 * class downloads nothing by itself, whoever owns the setting asks through `refreshIfStale`.
 *
 * The file (about a million and a half lines) is streamed, never held whole: it is written into a
 * disposable table next to the live one, which replaces it in one transaction when the download is
 * complete, so a lookup never sees half a file and a failed download keeps yesterday's. A lookup
 * is one query by id.
 */
export class ImdbRatings {
  /** Set by the app, which owns the log. */
  log: ImdbLog | undefined;
  /** Told when the task moved, so the activity panel reads again. */
  onChange: (() => void) | undefined;

  private latest: ImdbTask | undefined;
  private failedAt = 0;
  private running: Promise<void> | undefined;
  private lookup: ReturnType<Database['prepare']> | undefined;

  constructor(
    private readonly db: Database,
    private readonly options: {
      fetch?: typeof fetch;
      now?: () => number;
      url?: string;
    } = {},
  ) {
    // Disposable, and the shape changed before release: a table of an older shape is forgotten
    // (the file is downloaded again) rather than migrated.
    const columns = db.prepare<[], { name: string }>('PRAGMA table_info(imdb_ratings_info)').all();
    if (columns.length > 0 && !columns.some(({ name }) => name === 'entries')) {
      db.exec('DROP TABLE imdb_ratings_info');
      db.exec('DROP TABLE IF EXISTS imdb_ratings');
    }
    db.exec(`CREATE TABLE IF NOT EXISTS imdb_ratings (
      id TEXT PRIMARY KEY,
      rating REAL NOT NULL,
      votes INTEGER NOT NULL
    ) WITHOUT ROWID`);
    db.exec(`CREATE TABLE IF NOT EXISTS imdb_ratings_info (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      fetched_at INTEGER NOT NULL,
      entries INTEGER NOT NULL
    )`);
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  task(): ImdbTask | undefined {
    return this.latest;
  }

  /** When the dataset in the database was downloaded, or `null` if it never was. */
  fetchedAt(): number | null {
    return this.stored()?.fetched_at ?? null;
  }

  private stored(): { fetched_at: number; entries: number } | undefined {
    return this.db
      .prepare<[], { fetched_at: number; entries: number }>(
        'SELECT fetched_at, entries FROM imdb_ratings_info',
      )
      .get();
  }

  /**
   * What the Maintenance tab shows, whether the setting is on or not. The count is stored when a
   * download ends: counting a million and a half rows would be a read that lasts.
   */
  figures(): { entries: number; fetchedAt: string | null; task: ImdbTask | null } {
    const stored = this.stored();
    return {
      entries: stored?.entries ?? 0,
      fetchedAt: stored ? new Date(stored.fetched_at).toISOString() : null,
      task: this.latest ?? null,
    };
  }

  /** Whether a download is in progress: forgetting the dataset under it would lose its work. */
  get downloading(): boolean {
    return this.running !== undefined;
  }

  /**
   * Forgets the dataset. The table is dropped and made again, which is instant, where deleting a
   * million and a half rows is not. Returns how many ratings there were.
   */
  clear(): number {
    const removed = this.stored()?.entries ?? 0;
    this.db.transaction(() => {
      this.db.exec('DROP TABLE imdb_ratings');
      this.db.exec(`CREATE TABLE imdb_ratings (
        id TEXT PRIMARY KEY,
        rating REAL NOT NULL,
        votes INTEGER NOT NULL
      ) WITHOUT ROWID`);
      this.db.exec('DELETE FROM imdb_ratings_info');
    })();
    this.lookup = undefined;
    this.latest = undefined;
    this.failedAt = 0;
    return removed;
  }

  rating(imdbId: string): Rating | undefined {
    this.lookup ??= this.db.prepare('SELECT rating, votes FROM imdb_ratings WHERE id = ?');
    const row = this.lookup.get(imdbId) as { rating: number; votes: number } | undefined;
    return row && { value: row.rating, votes: row.votes };
  }

  /** Starts a download when there is none yet or it is a day old; a no-op otherwise. */
  refreshIfStale(): void {
    if (this.running) {
      return;
    }
    const at = this.now();
    const fetched = this.fetchedAt();
    if (fetched !== null && at - fetched < MAX_AGE_MS) {
      return;
    }
    if (at - this.failedAt < RETRY_MS) {
      return;
    }
    void this.refresh();
  }

  /** Resolves when the download in progress, if any, has ended. */
  async idle(): Promise<void> {
    await this.running;
  }

  /** The download, which resolves when it ends. It never rejects: a failure is the task's. */
  refresh(): Promise<void> {
    this.running ??= this.download().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async download(): Promise<void> {
    const task: ImdbTask = {
      status: 'running',
      done: 0,
      startedAt: new Date(this.now()).toISOString(),
      endedAt: null,
      error: null,
    };
    this.latest = task;
    this.onChange?.();
    try {
      await this.load(task);
      task.status = 'done';
      this.log?.info({ ratings: task.done }, 'Downloaded the IMDb ratings');
    } catch (error) {
      task.status = 'failed';
      task.error = failureOf(error);
      this.failedAt = this.now();
      this.db.exec('DROP TABLE IF EXISTS imdb_ratings_next');
      this.log?.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'The download of the IMDb ratings failed',
      );
    }
    task.endedAt = new Date(this.now()).toISOString();
    this.onChange?.();
  }

  private async load(task: ImdbTask): Promise<void> {
    const response = await (this.options.fetch ?? fetch)(this.options.url ?? IMDB_RATINGS_URL, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!response.ok || response.body === null) {
      throw new Error(`IMDb answered ${String(response.status)}`);
    }
    this.db.exec('DROP TABLE IF EXISTS imdb_ratings_next');
    this.db.exec(`CREATE TABLE imdb_ratings_next (
      id TEXT PRIMARY KEY,
      rating REAL NOT NULL,
      votes INTEGER NOT NULL
    ) WITHOUT ROWID`);
    const insert = this.db.prepare(
      'INSERT OR REPLACE INTO imdb_ratings_next (id, rating, votes) VALUES (?, ?, ?)',
    );
    const write = this.db.transaction((rows: [string, number, number][]) => {
      for (const row of rows) {
        insert.run(...row);
      }
    });

    const lines = createInterface({
      input: Readable.fromWeb(response.body as never).pipe(createGunzip()),
      crlfDelay: Infinity,
    });
    let rows: [string, number, number][] = [];
    let header = true;
    for await (const line of lines) {
      if (header) {
        header = false;
        if (!line.startsWith('tconst\t')) {
          throw new Error('Unexpected IMDb ratings file');
        }
        continue;
      }
      const [id, average, votes] = line.split('\t');
      const value = Number(average);
      const count = Number(votes);
      if (!id?.startsWith('tt') || !Number.isFinite(value) || !Number.isFinite(count)) {
        continue;
      }
      rows.push([id, value, count]);
      if (rows.length >= BATCH) {
        write(rows);
        task.done += rows.length;
        rows = [];
        this.onChange?.();
        // The rows are written synchronously: let a request be answered in between.
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    write(rows);
    task.done += rows.length;
    if (task.done === 0) {
      throw new Error('The IMDb ratings file is empty');
    }

    const swap = this.db.transaction(() => {
      this.db.exec('DROP TABLE imdb_ratings');
      this.db.exec('ALTER TABLE imdb_ratings_next RENAME TO imdb_ratings');
      this.db
        .prepare(
          'INSERT INTO imdb_ratings_info (singleton, fetched_at, entries) VALUES (1, ?, ?) ' +
            'ON CONFLICT (singleton) DO UPDATE SET fetched_at = excluded.fetched_at, ' +
            'entries = excluded.entries',
        )
        .run(this.now(), task.done);
    });
    swap();
    // The prepared lookup points at the table that was dropped.
    this.lookup = undefined;
  }
}

const instances = new WeakMap<Database, ImdbRatings>();

/** The one dataset of a database, shared by the providers made per call and by the app. */
export function imdbRatingsOf(database: Database): ImdbRatings {
  let ratings = instances.get(database);
  if (!ratings) {
    ratings = new ImdbRatings(database);
    instances.set(database, ratings);
  }
  return ratings;
}

/**
 * The provider, whose details also carry IMDb's rating when the dataset knows the work. A work
 * the dataset lacks, or a dataset not downloaded yet, is left as the provider gave it.
 */
export function withImdbRatings(
  provider: MetadataProvider,
  ratings: Pick<ImdbRatings, 'rating'>,
): MetadataProvider {
  const added = <T extends { imdbId?: string }>(details: T | null): T | null => {
    const rating = details?.imdbId === undefined ? undefined : ratings.rating(details.imdbId);
    return details && rating ? { ...details, imdbRating: rating } : details;
  };
  return new Proxy(provider, {
    get(target, property) {
      if (property === 'getMovieDetails') {
        return async (...args: Parameters<MetadataProvider['getMovieDetails']>) =>
          added(await target.getMovieDetails(...args));
      }
      if (property === 'getSeriesDetails') {
        return async (...args: Parameters<MetadataProvider['getSeriesDetails']>) =>
          added(await target.getSeriesDetails(...args));
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value.bind(target) as unknown) : value;
    },
  });
}
