import { describe, expect, it } from 'vitest';
import {
  NO_FILTERS,
  detailOf,
  formatFull,
  formatLogTime,
  isFiltered,
  logsQuery,
  type LogEntry,
} from '../src/lib/logs.js';

describe('logsQuery', () => {
  it('asks for the default page with no filter', () => {
    expect(logsQuery(NO_FILTERS)).toBe('?limit=500');
  });

  it('carries each filter that is set, and a trimmed search', () => {
    expect(
      logsQuery(
        { level: 'warn', component: 'tmdb', q: '  429 ', period: '1h' },
        { limit: 1, after: 7 },
      ),
    ).toBe('?level=warn&component=tmdb&q=429&minutes=60&limit=1&after=7');
  });

  it('turns each period into minutes, and "everything kept" into none', () => {
    expect(logsQuery({ ...NO_FILTERS, period: '15m' })).toContain('minutes=15');
    expect(logsQuery({ ...NO_FILTERS, period: '24h' })).toContain('minutes=1440');
    expect(logsQuery({ ...NO_FILTERS, period: 'all' })).not.toContain('minutes');
  });
});

describe('isFiltered', () => {
  it('is false for the defaults and true as soon as one filter is set', () => {
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, q: '  ' })).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, q: 'x' })).toBe(true);
    expect(isFiltered({ ...NO_FILTERS, level: 'error' })).toBe(true);
    expect(isFiltered({ ...NO_FILTERS, component: 'http' })).toBe(true);
    expect(isFiltered({ ...NO_FILTERS, period: '24h' })).toBe(true);
  });
});

describe('formatLogTime', () => {
  const now = new Date(2026, 10, 12, 15, 0, 0);

  it('shows the clock alone for today and the day too for an older line', () => {
    const today = new Date(2026, 10, 12, 14, 32, 8).toISOString();
    const earlier = new Date(2026, 10, 10, 3, 12, 41).toISOString();
    expect(formatLogTime(today, 'fr', now)).toBe('14:32:08');
    expect(formatLogTime(earlier, 'fr', now)).toBe('10/11 03:12:41');
  });

  it('gives back what it cannot read', () => {
    expect(formatLogTime('not a date', 'en', now)).toBe('not a date');
  });
});

describe('formatFull', () => {
  it('shows the day and the time to the millisecond, and gives back what it cannot read', () => {
    const at = new Date(2026, 10, 12, 14, 32, 8, 412).toISOString();
    expect(formatFull(at, 'fr')).toContain('14:32:08,412');
    expect(formatFull(at, 'en')).toContain('14:32:08.412');
    expect(formatFull('nope', 'en')).toBe('nope');
  });
});

describe('detailOf', () => {
  const entry: LogEntry = {
    seq: 1,
    time: '2026-11-12T14:32:08.000Z',
    level: 'error',
    component: 'tmdb',
    message: 'gave up',
    job: 'job-1',
    data: { status: 429 },
  };

  it('lists the line with its own fields, and the job only when there is one', () => {
    expect(JSON.parse(detailOf(entry))).toEqual({
      time: entry.time,
      level: 'error',
      component: 'tmdb',
      message: 'gave up',
      job: 'job-1',
      status: 429,
    });
    expect(JSON.parse(detailOf({ ...entry, job: null }))).not.toHaveProperty('job');
  });
});
