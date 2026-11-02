import { GuessitParser, isTitledEpisode, voteRelease } from '@kinoshelf/core';
import { describe, expect, it } from 'vitest';
import { loadEntries } from '../src/entries.js';

/**
 * Real folders of the corpus: the episodes expected to be one series must never be set apart
 * from each other by the vote. A folder is the first segment of the (cut) path.
 */
describe('release vote on real folders', async () => {
  const parser = new GuessitParser();
  const folders = new Map<string, { path: string; tmdb: number }[]>();
  for (const entry of await loadEntries()) {
    const [first, ...rest] = entry.path.split('/');
    if (rest.length === 0 || entry.expect.status !== 'matched' || entry.expect.kind !== 'series') {
      continue;
    }
    folders.set(first as string, [
      ...(folders.get(first as string) ?? []),
      { path: entry.path, tmdb: entry.expect.tmdb },
    ]);
  }
  // `SERIES` is a library root cut from a real path, many shows side by side: not a release.
  const releases = [...folders].filter(([name, files]) => files.length > 1 && name !== 'SERIES');

  it('has real folders to look at', () => {
    expect(releases.length).toBeGreaterThanOrEqual(5);
  });

  it.each(releases)('keeps the episodes of %s together', (_folder, files) => {
    const parsed = files.map(({ path }) => parser.parse(path)).filter(isTitledEpisode);
    expect(parsed.length).toBeGreaterThan(1);
    expect(voteRelease(parsed).detached.map((i) => parsed[i]?.path)).toEqual([]);
  });
});
