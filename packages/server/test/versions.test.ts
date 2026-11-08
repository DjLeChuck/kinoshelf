import { describe, expect, it } from 'vitest';
import {
  coverageOf,
  distinctEpisodes,
  hasIncompleteVersion,
  hasSeveralVersions,
  versionsOf,
  type VersionRow,
} from '../src/versions.js';

const file = (
  season: number,
  episode: number,
  resolution: string | null,
  episodeEnd: number | null = null,
): VersionRow => ({ season, episode, episodeEnd, resolution });

/** Eight episodes in 1080p, seven of them also in 2160p (episode 3 only exists in 1080p). */
const season = (): VersionRow[] => [
  ...Array.from({ length: 8 }, (_, i) => file(1, i + 1, '1080p')),
  ...[1, 2, 4, 5, 6, 7, 8].map((episode) => file(1, episode, '2160p')),
];

describe('distinctEpisodes', () => {
  it('counts an episode once, however many versions hold it', () => {
    expect(distinctEpisodes(season())).toBe(8);
  });

  it('counts each number of a multi-episode file', () => {
    expect(distinctEpisodes([file(1, 2, '1080p', 4), file(1, 3, '2160p')])).toBe(3);
  });

  it('leaves out what is no episode', () => {
    expect(
      distinctEpisodes([{ season: null, episode: null, episodeEnd: null, resolution: null }]),
    ).toBe(0);
  });
});

describe('versionsOf and coverageOf', () => {
  it('measures each version against the episodes held, the larger picture first', () => {
    expect(versionsOf(season())).toEqual(['2160p', '1080p']);
    expect(coverageOf(season())).toEqual([
      { resolution: '2160p', covered: 7, total: 8 },
      { resolution: '1080p', covered: 8, total: 8 },
    ]);
  });

  it('gives a version absent from a season no coverage of it, against the show’s versions', () => {
    const rows = [...season(), file(2, 1, '1080p'), file(2, 2, '1080p')];
    const two = rows.filter((row) => row.season === 2);
    expect(coverageOf(two, versionsOf(rows))).toEqual([
      { resolution: '2160p', covered: 0, total: 2 },
      { resolution: '1080p', covered: 2, total: 2 },
    ]);
  });

  it('counts a multi-episode file for each of its episodes', () => {
    const rows = [file(1, 1, '1080p', 2), file(1, 1, '2160p'), file(1, 2, '2160p')];
    expect(coverageOf(rows).map(({ covered }) => covered)).toEqual([2, 2]);
  });

  it('makes no version of a file whose name says no size, unless it shares an episode', () => {
    const alone = [file(1, 1, '1080p'), file(1, 2, null)];
    expect(versionsOf(alone)).toEqual(['1080p']);
    // The unlabelled episode is left out of the total: it does not make 1080p look incomplete.
    expect(coverageOf(alone)).toEqual([{ resolution: '1080p', covered: 1, total: 1 }]);

    const shared = [file(1, 1, '1080p'), file(1, 1, null)];
    expect(versionsOf(shared)).toEqual(['1080p', null]);
  });

  it('has no version when nothing says one', () => {
    expect(versionsOf([file(1, 1, null), file(1, 2, null)])).toEqual([]);
    expect(coverageOf([file(1, 1, null)])).toEqual([]);
  });
});

describe('the version filters', () => {
  it('tells a show held in several versions', () => {
    expect(hasSeveralVersions(season())).toBe(true);
    expect(hasSeveralVersions([file(1, 1, '1080p'), file(1, 2, '1080p')])).toBe(false);
    expect(hasSeveralVersions([file(1, 1, '1080p', 2), file(1, 2, '2160p')])).toBe(true);
  });

  it('tells a show where a version lacks an episode another one holds', () => {
    expect(hasIncompleteVersion(season())).toBe(true);
    expect(
      hasIncompleteVersion([
        file(1, 1, '1080p'),
        file(1, 1, '2160p'),
        file(1, 2, '1080p'),
        file(1, 2, '2160p'),
      ]),
    ).toBe(false);
    expect(hasIncompleteVersion([file(1, 1, '1080p'), file(1, 2, '1080p')])).toBe(false);
  });
});
