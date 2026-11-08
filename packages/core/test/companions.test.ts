import { describe, expect, it } from 'vitest';
import {
  companionKindOf,
  companionsWritten,
  buildProfile,
  expectedNfoPaths,
  nfoCoverage,
  showFileNames,
} from '../src/index.js';
import { parseProfile } from '../src/profiles/loader.js';
import type { Profile } from '../src/types/profile.js';

const profile = (nfo: string, artwork: string): Profile =>
  parseProfile(`
id: test
episodeRangeSeparator: '-e'
templates:
  movieFolder: ''
  movieFile: '{title} ({year})'
  seriesFolder: '{title}'
  seasonFolder: 'Season {season:02}'
  episodeFile: '{title} s{season:02}e{episode:02}'
nfo: ${nfo}
artwork: ${artwork}
filesystem: { forbidden: windows, replacement: '_', maxSegmentBytes: 255 }
`);

describe('companionsWritten', () => {
  it('writes every file of a movie that has its own folder', () => {
    expect(
      companionsWritten(buildProfile({ naming: 'with-id', metadata: 'nfo' }), 'movie', false),
    ).toEqual({
      nfo: true,
      poster: true,
      fanart: true,
      logo: true,
    });
  });

  it('writes no fixed name for a movie written flat, only an NFO named after the video', () => {
    const named = profile(
      "{ format: kodi, movie: '{file}.nfo', episode: '{file}.nfo' }",
      '[{ kind: poster, name: poster.jpg }]',
    );
    expect(companionsWritten(named, 'movie', true)).toEqual({
      nfo: true,
      poster: false,
      fanart: false,
      logo: false,
    });
  });

  it('reads `\\{file\\}` as literal text, not as the video name', () => {
    const literal = profile(
      "{ format: kodi, movie: '\\{file\\}.nfo', episode: '{file}.nfo' }",
      '[]',
    );
    expect(companionsWritten(literal, 'movie', true).nfo).toBe(false);
  });

  it('counts only its own NFO for an episode', () => {
    expect(
      companionsWritten(buildProfile({ naming: 'with-id', metadata: 'nfo' }), 'series', false),
    ).toEqual({
      nfo: true,
      poster: false,
      fanart: false,
      logo: false,
    });
    expect(
      companionsWritten(buildProfile({ naming: 'with-id', metadata: 'none' }), 'series', false).nfo,
    ).toBe(false);
  });
});

describe('companionKindOf', () => {
  it('tells an episode or movie NFO and images apart from the show’s NFO', () => {
    const jellyfin = buildProfile({ naming: 'with-id', metadata: 'nfo' });
    expect(companionKindOf(jellyfin, 'Show s01e01.nfo')).toBe('nfo');
    expect(companionKindOf(jellyfin, 'movie.nfo')).toBe('nfo');
    expect(companionKindOf(jellyfin, 'tvshow.nfo')).toBeUndefined();
    expect(companionKindOf(jellyfin, 'poster.jpg')).toBe('poster');
    expect(companionKindOf(jellyfin, 'background.jpg')).toBe('fanart');
    expect(companionKindOf(jellyfin, 'Show s01e01.mkv')).toBeUndefined();
  });

  it('compares with the names as the profile writes them, not with its templates', () => {
    const braces = profile('null', "[{ kind: poster, name: '\\{cover\\}.jpg' }]");
    expect(companionKindOf(braces, '{cover}.jpg')).toBe('poster');
    expect(companionKindOf(braces, '\\{cover\\}.jpg')).toBeUndefined();
  });

  it('knows nothing of NFO files when the profile writes none', () => {
    expect(
      companionKindOf(buildProfile({ naming: 'with-id', metadata: 'none' }), 'movie.nfo'),
    ).toBeUndefined();
  });
});

describe('showFileNames', () => {
  it('names the show’s files and a season’s poster', () => {
    const kodi = profile(
      "{ format: kodi, movie: movie.nfo, episode: '{file}.nfo', series: tvshow.nfo }",
      "[{ kind: poster, name: poster.jpg }, { kind: season-poster, name: 'season{season:02}-poster.jpg' }]",
    );
    const names = showFileNames(kodi);
    expect(names).toMatchObject({ nfo: 'tvshow.nfo', poster: 'poster.jpg', fanart: undefined });
    expect(names.seasonPoster(3)).toBe('season03-poster.jpg');
  });

  it('gives season 0 its own poster name when the profile has one', () => {
    const names = showFileNames(buildProfile({ naming: 'no-id', metadata: 'nfo' }));
    expect(names.seasonPoster(1)).toBe('season01-poster.jpg');
    expect(names.seasonPoster(0)).toBe('season-specials-poster.jpg');
    // The same file for both players: a library reads alike under either.
    const jellyfin = showFileNames(buildProfile({ naming: 'with-id', metadata: 'nfo' }));
    expect(jellyfin.seasonPoster(1)).toBe('season01-poster.jpg');
    expect(jellyfin.seasonPoster(0)).toBe('season-specials-poster.jpg');
  });

  it('has no name for what the profile does not write', () => {
    const names = showFileNames(buildProfile({ naming: 'with-id', metadata: 'none' }));
    expect(names).toMatchObject({ nfo: undefined, poster: undefined, fanart: undefined });
    expect(names.seasonPoster(1)).toBeUndefined();
  });
});

describe('expectedNfoPaths', () => {
  const nfo = buildProfile({ naming: 'with-id', metadata: 'nfo' });
  const folder = ['Dune (2021) {tmdb-438631}'];

  it('wants one movie.nfo for a movie, whatever its versions', () => {
    const stems = ['Dune (2021) {tmdb-438631} - 1080p', 'Dune (2021) {tmdb-438631} - 2160p'];
    expect(expectedNfoPaths(nfo, 'movie', folder, stems)).toEqual([
      'Dune (2021) {tmdb-438631}/movie.nfo',
    ]);
    expect(expectedNfoPaths(nfo, 'movie', folder, stems.slice(0, 1))).toEqual([
      'Dune (2021) {tmdb-438631}/movie.nfo',
    ]);
  });

  it('wants one NFO per video for an episode', () => {
    const season = ['Foundation (2021)', 'Season 01'];
    expect(
      expectedNfoPaths(nfo, 'series', season, [
        'Foundation (2021) - s01e01 - 1080p',
        'Foundation (2021) - s01e01 - 2160p',
      ]),
    ).toEqual([
      'Foundation (2021)/Season 01/Foundation (2021) - s01e01 - 1080p.nfo',
      'Foundation (2021)/Season 01/Foundation (2021) - s01e01 - 2160p.nfo',
    ]);
  });

  it('wants nothing when the profile writes no NFO', () => {
    const none = buildProfile({ naming: 'with-id', metadata: 'none' });
    expect(expectedNfoPaths(none, 'movie', folder, ['Dune'])).toEqual([]);
    expect(expectedNfoPaths(none, 'series', ['Show', 'Season 01'], ['Show - s01e01'])).toEqual([]);
  });

  it('wants no movie.nfo for a movie written flat, which every movie would share', () => {
    expect(expectedNfoPaths(nfo, 'movie', [], ['Dune (2021)'])).toEqual([]);
  });
});

describe('nfoCoverage', () => {
  it('counts the expected NFO that exist', () => {
    const expected = ['a/one.nfo', 'a/two.nfo'];
    expect(nfoCoverage(expected, (path) => path === 'a/one.nfo')).toEqual({
      expected,
      present: ['a/one.nfo'],
    });
    expect(nfoCoverage(expected, () => true).present).toEqual(expected);
    expect(nfoCoverage([], () => true)).toEqual({ expected: [], present: [] });
  });
});
