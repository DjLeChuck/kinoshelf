import { Database } from '@kinoshelf/core';
import { SqliteHttpCache, type TmdbUsageEvent } from '@kinoshelf/provider-tmdb';
import { afterEach, describe, expect, it } from 'vitest';
import { TmdbUsage } from '../src/tmdb-usage.js';
import { cleanup, harness } from './harness.js';
import { tmdbUsageOf } from '../src/tmdb-usage.js';

afterEach(cleanup);

const HOUR = 3_600_000;
const event = (partial: Partial<TmdbUsageEvent>): TmdbUsageEvent => ({
  kind: 'search',
  outcome: 'network',
  ms: 100,
  path: '/3/search/movie',
  status: 200,
  attempt: 0,
  final: true,
  ...partial,
});

describe('TmdbUsage', () => {
  it('counts per outcome and kind, and reads the median from the latencies', () => {
    let now = Date.parse('2026-03-10T12:30:00Z');
    const usage = new TmdbUsage(new Database(':memory:'), () => now);
    for (const ms of [100, 100, 100, 800, 800]) {
      usage.record(event({ ms }));
    }
    usage.record(event({ outcome: 'cache', kind: 'movie' }));
    usage.record(event({ outcome: 'rate-limited', status: 429, final: false }));

    const report = usage.report('24h');
    expect(report.totals).toMatchObject({ network: 5, cache: 1, rateLimited: 1 });
    // Three of five took about 100 ms: the median is theirs, to within a bucket.
    expect(report.totals.latencyMs).toBeGreaterThan(85);
    expect(report.totals.latencyMs).toBeLessThan(115);
    expect(report.kinds.find((k) => k.kind === 'movie')?.cache).toBe(1);
    expect(report.recentErrors).toHaveLength(1);
    now += 1;
  });

  it('gives one slot per hour for a day, and per day for a week, empty ones included', () => {
    const now = Date.parse('2026-03-10T12:30:00Z');
    const usage = new TmdbUsage(new Database(':memory:'), () => now);
    usage.record(event({}));
    const day = usage.report('24h');
    expect(day.slots).toHaveLength(24);
    expect(day.slots.at(-1)).toMatchObject({ start: '2026-03-10T12:00:00.000Z', network: 1 });
    const week = usage.report('7d');
    expect(week.slots).toHaveLength(7);
    expect(week.slots.at(-1)).toMatchObject({ start: '2026-03-10T00:00:00.000Z', network: 1 });
  });

  it('keeps counts across a restart, and forgets what is older than the longest period', () => {
    const database = new Database(':memory:');
    let now = Date.parse('2026-03-10T12:30:00Z');
    const first = new TmdbUsage(database, () => now);
    first.record(event({}));
    first.close();
    now += 40 * 24 * HOUR;
    const second = new TmdbUsage(database, () => now);
    expect(second.prune()).toBe(1);
    expect(second.report('30d').totals.network).toBe(0);
  });

  it('logs a limited request as a warning and a given-up call as an error', () => {
    const lines: string[] = [];
    const usage = new TmdbUsage(new Database(':memory:'));
    usage.log = {
      warn: (_data, message) => lines.push(`warn ${message}`),
      error: (_data, message) => lines.push(`error ${message}`),
    };
    usage.record(event({ outcome: 'rate-limited', status: 429, final: false }));
    usage.record(event({ outcome: 'rate-limited', status: 429, attempt: 3, final: true }));
    expect(lines).toEqual([
      'warn TMDB limited the rate (429): sending it again',
      'error TMDB limited the rate (429): gave up after 4 request(s)',
    ]);
  });
});

describe('GET /api/tmdb/usage and DELETE /api/tmdb/cache', () => {
  it('reports the counts and the cache, then forgets the cache', async () => {
    const h = await harness();
    tmdbUsageOf(h.database).record(event({}));
    new SqliteHttpCache(h.database).set('/3/x?', { status: 200, body: 'abcd' }, Date.now() + 1e6);

    const read = await h.request('GET', '/api/tmdb/usage?period=7d');
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      period: '7d',
      totals: { network: 1 },
      cache: { entries: 1, bytes: 4 },
    });

    const cleared = await h.request('DELETE', '/api/tmdb/cache');
    expect(cleared.json()).toEqual({ removed: 1 });
    const after = await h.request('GET', '/api/tmdb/usage');
    expect(after.json()).toMatchObject({ period: '24h', cache: { entries: 0 } });
  });

  it('refuses an unknown period', async () => {
    const h = await harness();
    expect((await h.request('GET', '/api/tmdb/usage?period=1y')).statusCode).toBe(400);
  });
});
