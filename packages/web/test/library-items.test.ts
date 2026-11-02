import { describe, expect, it } from 'vitest';
import {
  canRun,
  episodeLabel,
  isSettling,
  isStalled,
  itemsUrl,
  partition,
  tally,
  scanPercent,
  showsUrl,
  type ScanProgress,
} from '../src/lib/library-items.js';

const progress = (over: Partial<ScanProgress> = {}): ScanProgress => ({
  phase: 'identify',
  found: 100,
  done: 25,
  total: 100,
  current: null,
  idleSeconds: 0,
  ...over,
});

describe('itemsUrl', () => {
  it('asks only for what is set, and encodes the text', () => {
    expect(itemsUrl('films', { limit: 50 })).toBe('/api/libraries/films/items?limit=50');
    expect(itemsUrl('films', { state: 'review', q: ' blade runner ', limit: 100 })).toBe(
      '/api/libraries/films/items?state=review&q=blade%20runner&limit=100',
    );
    expect(itemsUrl('films', { q: '  ', limit: 50 })).not.toContain('q=');
  });
});

describe('scanPercent', () => {
  it('is unknown while the folder is still being walked, and a whole percent after', () => {
    expect(scanPercent(null)).toBeUndefined();
    expect(scanPercent(progress({ phase: 'discover' }))).toBeUndefined();
    expect(scanPercent(progress({ total: 0 }))).toBeUndefined();
    expect(scanPercent(progress())).toBe(25);
    expect(scanPercent(progress({ done: 100 }))).toBe(100);
  });
});

describe('isStalled', () => {
  it('says so after a minute without movement', () => {
    expect(isStalled(progress({ idleSeconds: 59 }))).toBe(false);
    expect(isStalled(progress({ idleSeconds: 60 }))).toBe(true);
    expect(isStalled(null)).toBe(false);
  });
});

describe('showsUrl', () => {
  it('asks only for what is set', () => {
    expect(showsUrl('series', { limit: 50 })).toBe('/api/libraries/series/shows?limit=50');
    expect(showsUrl('series', { q: ' the office ', missing: true, limit: 20 })).toBe(
      '/api/libraries/series/shows?q=the%20office&missing=true&limit=20',
    );
    expect(showsUrl('series', { missing: false, limit: 50 })).not.toContain('missing');
    expect(showsUrl('series', { incomplete: true, limit: 50 })).toBe(
      '/api/libraries/series/shows?incomplete=true&limit=50',
    );
  });
});

describe('episodeLabel', () => {
  it('pads the numbers and shows the end of a range', () => {
    expect(episodeLabel(1, 2)).toBe('S01E02');
    expect(episodeLabel(12, 105)).toBe('S12E105');
    expect(episodeLabel(1, 2, 3)).toBe('S01E02-E03');
    expect(episodeLabel(0, 1)).toBe('S00E01');
  });

  it('is empty for a file without a season or an episode', () => {
    expect(episodeLabel(null, null)).toBe('');
    expect(episodeLabel(1, null)).toBe('');
  });
});

describe('isSettling', () => {
  it('is true for the files a person must decide', () => {
    expect(isSettling({ state: 'review' })).toBe(true);
    expect(isSettling({ state: 'unrecognized' })).toBe(true);
    expect(isSettling({ state: 'rename' })).toBe(false);
    expect(isSettling({ state: 'ok' })).toBe(false);
  });
});

describe('canRun and partition', () => {
  const rows = [
    { id: 'a', state: 'rename' },
    { id: 'b', state: 'incomplete' },
    { id: 'c', state: 'ok' },
    { id: 'd', state: 'review' },
  ] as const;

  it('keeps what has something to run, and splits it by what is asked', () => {
    expect(rows.filter(canRun).map(({ id }) => id)).toEqual(['a', 'b']);
    expect(partition(rows)).toEqual({ rename: ['a'], refresh: ['b'] });
  });
});

describe('tally', () => {
  const op = (type: 'transfer' | 'write-file', status: 'done' | 'skipped' | 'failed') => ({
    type,
    role: null,
    source: null,
    destination: '/x',
    status,
    error: null,
  });

  it('counts moves and written files apart, and what would be left alone', () => {
    const report = {
      items: [
        { entryId: '1', results: [op('transfer', 'done'), op('write-file', 'done')] },
        { entryId: '2', results: [op('write-file', 'skipped'), op('write-file', 'failed')] },
      ],
    };
    expect(tally(report)).toEqual({ transfers: 1, written: 2, skipped: 1, failed: 1 });
  });
});
