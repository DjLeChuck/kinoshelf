import type { Database } from '@kinoshelf/core';
import {
  SqliteHttpCache,
  TMDB_CALL_KINDS,
  type TmdbCallKind,
  type TmdbOutcome,
  type TmdbUsageEvent,
  type UsageSink,
} from '@kinoshelf/provider-tmdb';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Counts older than this are forgotten (the longest period the page offers). */
export const USAGE_KEPT_DAYS = 30;
const FLUSH_MS = 5000;
const RECENT_ERRORS = 20;

export const USAGE_PERIODS = ['24h', '7d', '30d'] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

/** How many hours a period covers, and how many of them make one bar of the chart. */
const SPAN: Record<UsagePeriod, { hours: number; slotHours: number }> = {
  '24h': { hours: 24, slotHours: 1 },
  '7d': { hours: 7 * 24, slotHours: 24 },
  '30d': { hours: 30 * 24, slotHours: 24 },
};

// Latencies are kept in buckets 25 % wide (a median to within ±12 %), so a count per bucket is
// all that is stored: the median of a day is read from the buckets, not from every request.
const BUCKET_RATIO = 1.25;
const bucketOf = (ms: number): number =>
  Math.max(0, Math.round(Math.log(Math.max(ms, 1)) / Math.log(BUCKET_RATIO)));
const msOfBucket = (bucket: number): number => Math.round(BUCKET_RATIO ** bucket);

const ERROR_OUTCOMES: readonly TmdbOutcome[] = [
  'rate-limited',
  'server-error',
  'unreachable',
  'refused',
];

export interface RecentError {
  readonly at: string;
  readonly kind: TmdbCallKind;
  readonly outcome: TmdbOutcome;
  readonly status: number | null;
  readonly path: string;
}

export interface UsageCounts {
  readonly network: number;
  readonly cache: number;
  readonly rateLimited: number;
  readonly serverError: number;
  readonly unreachable: number;
  readonly refused: number;
  /** Median time of the requests that came back; `null` when none did. */
  readonly latencyMs: number | null;
}

export interface UsageReport {
  readonly period: UsagePeriod;
  readonly totals: UsageCounts;
  readonly slots: readonly { start: string; network: number; cache: number; errors: number }[];
  readonly kinds: readonly (UsageCounts & { kind: TmdbCallKind })[];
  readonly recentErrors: readonly RecentError[];
  readonly since: string;
  readonly cache: { entries: number; bytes: number };
}

/** What the log is told; the server's logger, once the app has one. */
export interface UsageLog {
  warn(data: object, message: string): void;
  error(data: object, message: string): void;
}

interface Row {
  hour: number;
  kind: TmdbCallKind;
  outcome: TmdbOutcome;
  bucket: number;
  count: number;
}

const emptyCounts = (): Record<TmdbOutcome, number> & { latencies: Map<number, number> } => ({
  cache: 0,
  network: 0,
  'rate-limited': 0,
  'server-error': 0,
  unreachable: 0,
  refused: 0,
  latencies: new Map(),
});

function countsOf(rows: readonly Row[]): UsageCounts {
  const sum = emptyCounts();
  for (const row of rows) {
    sum[row.outcome] += row.count;
    if (row.outcome === 'network') {
      sum.latencies.set(row.bucket, (sum.latencies.get(row.bucket) ?? 0) + row.count);
    }
  }
  const total = sum.network;
  let latencyMs: number | null = null;
  if (total > 0) {
    let seen = 0;
    for (const bucket of [...sum.latencies.keys()].sort((a, b) => a - b)) {
      seen += sum.latencies.get(bucket) ?? 0;
      if (seen * 2 >= total) {
        latencyMs = msOfBucket(bucket);
        break;
      }
    }
  }
  return {
    network: sum.network,
    cache: sum.cache,
    rateLimited: sum['rate-limited'],
    serverError: sum['server-error'],
    unreachable: sum.unreachable,
    refused: sum.refused,
    latencyMs,
  };
}

/**
 * What the TMDB client sent, counted per hour, kind of call and outcome. TMDB reports no quota,
 * so this is Kinoshelf's own count. The table is disposable (created on demand, forgotten after
 * thirty days); counts wait in memory and reach it every few seconds, so a scan making thousands
 * of calls does not write for each.
 */
export class TmdbUsage implements UsageSink {
  /** The sink's logger: set by the app, which owns the log. */
  log: UsageLog | undefined;
  /** Told when counts were written, so the page reads again. */
  onChange: (() => void) | undefined;

  private readonly pending = new Map<string, Row>();
  private readonly recent: RecentError[] = [];
  private readonly started: number;
  private readonly cache: SqliteHttpCache;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {
    this.started = now();
    this.cache = new SqliteHttpCache(db);
    db.exec(`CREATE TABLE IF NOT EXISTS tmdb_usage (
      hour INTEGER NOT NULL,
      kind TEXT NOT NULL,
      outcome TEXT NOT NULL,
      bucket INTEGER NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (hour, kind, outcome, bucket)
    ) WITHOUT ROWID`);
  }

  record(event: TmdbUsageEvent): void {
    const at = this.now();
    const hour = Math.floor(at / HOUR_MS);
    const bucket = event.outcome === 'network' && event.ms !== undefined ? bucketOf(event.ms) : 0;
    const key = `${String(hour)}|${event.kind}|${event.outcome}|${String(bucket)}`;
    const row = this.pending.get(key);
    if (row) {
      row.count += 1;
    } else {
      this.pending.set(key, { hour, kind: event.kind, outcome: event.outcome, bucket, count: 1 });
    }
    if (ERROR_OUTCOMES.includes(event.outcome)) {
      this.failed(event, at);
    }
    this.timer ??= setTimeout(() => {
      this.flush();
    }, FLUSH_MS).unref();
  }

  private failed(event: TmdbUsageEvent, at: number): void {
    this.recent.unshift({
      at: new Date(at).toISOString(),
      kind: event.kind,
      outcome: event.outcome,
      status: event.status ?? null,
      path: event.path,
    });
    this.recent.length = Math.min(this.recent.length, RECENT_ERRORS);
    const data = {
      path: event.path,
      ...(event.status !== undefined && { status: event.status }),
      attempt: event.attempt + 1,
    };
    const what =
      event.outcome === 'rate-limited'
        ? 'TMDB limited the rate (429)'
        : event.outcome === 'server-error'
          ? `TMDB answered with an error (${String(event.status)})`
          : event.outcome === 'unreachable'
            ? 'TMDB could not be reached'
            : `TMDB refused the request (${String(event.status)})`;
    if (event.final) {
      this.log?.error(data, `${what}: gave up after ${String(event.attempt + 1)} request(s)`);
    } else {
      this.log?.warn(data, `${what}: sending it again`);
    }
  }

  /** Writes the counts held in memory. */
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending.size === 0) {
      return;
    }
    const rows = [...this.pending.values()];
    this.pending.clear();
    const upsert = this.db.prepare(
      `INSERT INTO tmdb_usage (hour, kind, outcome, bucket, count) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (hour, kind, outcome, bucket) DO UPDATE SET count = count + excluded.count`,
    );
    this.db.transaction(() => {
      for (const row of rows) {
        upsert.run(row.hour, row.kind, row.outcome, row.bucket, row.count);
      }
    })();
    this.onChange?.();
  }

  /** Forgets the counts older than the longest period; returns how many rows went. */
  prune(): number {
    this.flush();
    const oldest = Math.floor((this.now() - USAGE_KEPT_DAYS * DAY_MS) / HOUR_MS);
    return this.db.prepare('DELETE FROM tmdb_usage WHERE hour < ?').run(oldest).changes;
  }

  report(period: UsagePeriod): UsageReport {
    this.flush();
    const { hours, slotHours } = SPAN[period];
    const nowHour = Math.floor(this.now() / HOUR_MS);
    // Days are UTC days, so a bar never straddles two of the server's.
    const slotOf = (hour: number): number =>
      slotHours === 1 ? hour : Math.floor(hour / slotHours) * slotHours;
    const lastSlot = slotOf(nowHour);
    const firstSlot = lastSlot - (hours / slotHours - 1) * slotHours;
    const rows = this.db
      .prepare<[number], Row>(
        'SELECT hour, kind, outcome, bucket, count FROM tmdb_usage WHERE hour >= ?',
      )
      .all(firstSlot);

    const slots = new Map<number, { network: number; cache: number; errors: number }>();
    for (let slot = firstSlot; slot <= lastSlot; slot += slotHours) {
      slots.set(slot, { network: 0, cache: 0, errors: 0 });
    }
    for (const row of rows) {
      const slot = slots.get(slotOf(row.hour));
      if (!slot) {
        continue;
      }
      if (row.outcome === 'network') {
        slot.network += row.count;
      } else if (row.outcome === 'cache') {
        slot.cache += row.count;
      } else {
        slot.errors += row.count;
      }
    }
    return {
      period,
      totals: countsOf(rows),
      slots: [...slots].map(([hour, counts]) => ({
        start: new Date(hour * HOUR_MS).toISOString(),
        ...counts,
      })),
      kinds: TMDB_CALL_KINDS.map((kind) => ({
        kind,
        ...countsOf(rows.filter((row) => row.kind === kind)),
      })),
      recentErrors: [...this.recent],
      since: new Date(this.started).toISOString(),
      cache: this.cache.stats(),
    };
  }

  /** Forgets every stored answer: the next analyses ask TMDB again. */
  clearCache(): number {
    return this.cache.clear();
  }

  close(): void {
    this.flush();
  }
}

const instances = new WeakMap<Database, TmdbUsage>();

/** The one counter of a database, shared by the providers made per call and by the routes. */
export function tmdbUsageOf(database: Database): TmdbUsage {
  let usage = instances.get(database);
  if (!usage) {
    usage = new TmdbUsage(database);
    instances.set(database, usage);
  }
  return usage;
}
