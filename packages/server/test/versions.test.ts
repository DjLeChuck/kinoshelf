import { describe, expect, it } from 'vitest';
import {
  coverageOf,
  distinctEpisodes,
  hasIncompleteVersion,
  showCoverageOf,
  hasSeveralVersions,
  seasonSignature,
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
      { resolution: '2160p', covered: 7, total: 8, accepted: false },
      { resolution: '1080p', covered: 8, total: 8, accepted: false },
    ]);
  });

  it('judges a version against its own season only, never the whole show', () => {
    const rows = [file(1, 1, '1080p'), file(1, 2, '1080p'), file(2, 1, '720p'), file(2, 2, '720p')];
    expect(hasIncompleteVersion(rows)).toBe(false);
    expect(showCoverageOf(rows)).toEqual([
      { resolution: '1080p', covered: 2, total: 2, accepted: true },
      { resolution: '720p', covered: 2, total: 2, accepted: true },
    ]);
    expect(hasIncompleteVersion([...rows, file(2, 3, '720p'), file(2, 3, '1080p')])).toBe(true);
  });

  it('counts a multi-episode file for each of its episodes', () => {
    const rows = [file(1, 1, '1080p', 2), file(1, 1, '2160p'), file(1, 2, '2160p')];
    expect(coverageOf(rows).map(({ covered }) => covered)).toEqual([2, 2]);
  });

  it('makes no version of a file whose name says no size, unless it shares an episode', () => {
    const alone = [file(1, 1, '1080p'), file(1, 2, null)];
    expect(versionsOf(alone)).toEqual(['1080p']);
    // The unlabelled episode is left out of the total: it does not make 1080p look incomplete.
    expect(coverageOf(alone)).toEqual([
      { resolution: '1080p', covered: 1, total: 1, accepted: true },
    ]);

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

describe('a season released in pieces', () => {
  /** The first half in 1080p, the rest in 4K: no episode has two files. */
  const pieces = (): VersionRow[] => [
    ...[1, 2, 3, 4].map((episode) => file(1, episode, '1080p')),
    ...[5, 6, 7, 8].map((episode) => file(1, episode, '2160p')),
  ];

  it('owes nothing: the pictures are not versions of one another', () => {
    expect(hasIncompleteVersion(pieces())).toBe(false);
    // The tally stays true to the files; only the follow-up is dropped.
    expect(coverageOf(pieces())).toEqual([
      { resolution: '2160p', covered: 4, total: 8, accepted: true },
      { resolution: '1080p', covered: 4, total: 8, accepted: true },
    ]);
    expect(showCoverageOf(pieces()).map(({ covered, total }) => [covered, total])).toEqual([
      [4, 4],
      [4, 4],
    ]);
  });

  it('is incomplete again as soon as one episode has two pictures', () => {
    expect(hasIncompleteVersion([...pieces(), file(1, 1, '2160p')])).toBe(true);
  });
});

describe('a season accepted as it is', () => {
  it('stops being incomplete, and only while its files stay the same', () => {
    const acks = new Map([[1, seasonSignature(season())]]);
    expect(hasIncompleteVersion(season(), acks)).toBe(false);
    expect(showCoverageOf(season(), acks).map(({ covered, total }) => [covered, total])).toEqual([
      [7, 7],
      [8, 8],
    ]);
    // A new picture arrives for episode 3: the acceptance lapses.
    expect(hasIncompleteVersion([...season(), file(1, 3, '720p')], acks)).toBe(true);
    // Another season is not covered by it.
    const second = [file(2, 1, '1080p'), file(2, 2, '1080p'), file(2, 1, '2160p')];
    expect(hasIncompleteVersion([...season(), ...second], acks)).toBe(true);
  });

  it('keeps the signature of a season whatever the order of its files', () => {
    expect(seasonSignature(season())).toBe(seasonSignature([...season()].reverse()));
  });
});
