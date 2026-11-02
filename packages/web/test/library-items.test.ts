import { describe, expect, it } from 'vitest';
import {
  formatSize,
  isStalled,
  itemsUrl,
  scanPercent,
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

describe('formatSize', () => {
  it.each([
    [512, '512 B'],
    [1536, '1.5 KB'],
    [1_500_000_000, '1.4 GB'],
  ])('%d is %s', (bytes, expected) => {
    expect(formatSize(bytes)).toBe(expected);
  });
});
