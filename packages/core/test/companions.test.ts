import { describe, expect, it } from 'vitest';
import {
  companionKindOf,
  companionsWritten,
  loadBundledProfile,
  showFileNames,
} from '../src/index.js';
import { parseProfile } from '../src/profiles/loader.js';
import type { Profile } from '../src/types/profile.js';

const profile = (nfo: string, artwork: string): Profile =>
  parseProfile(`
id: test
name: Test
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
  it('writes every file of a movie that has its own folder', async () => {
    expect(companionsWritten(await loadBundledProfile('jellyfin'), 'movie', false)).toEqual({
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

  it('counts only its own NFO for an episode', async () => {
    expect(companionsWritten(await loadBundledProfile('jellyfin'), 'series', false)).toEqual({
      nfo: true,
      poster: false,
      fanart: false,
      logo: false,
    });
    expect(companionsWritten(await loadBundledProfile('plex'), 'series', false).nfo).toBe(false);
  });
});

describe('companionKindOf', () => {
  it('tells an episode or movie NFO and images apart from the show’s NFO', async () => {
    const jellyfin = await loadBundledProfile('jellyfin');
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

  it('knows nothing of NFO files when the profile writes none', async () => {
    expect(companionKindOf(await loadBundledProfile('plex'), 'movie.nfo')).toBeUndefined();
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

  it('gives season 0 its own poster name when the profile has one', async () => {
    const names = showFileNames(await loadBundledProfile('plex-nfo'));
    expect(names.seasonPoster(1)).toBe('season01-poster.jpg');
    expect(names.seasonPoster(0)).toBe('season-specials-poster.jpg');
    // The same file for both players: a library reads alike under either.
    const jellyfin = showFileNames(await loadBundledProfile('jellyfin'));
    expect(jellyfin.seasonPoster(1)).toBe('season01-poster.jpg');
    expect(jellyfin.seasonPoster(0)).toBe('season-specials-poster.jpg');
  });

  it('has no name for what the profile does not write', async () => {
    const names = showFileNames(await loadBundledProfile('plex'));
    expect(names).toMatchObject({ nfo: undefined, poster: undefined, fanart: undefined });
    expect(names.seasonPoster(1)).toBeUndefined();
  });
});
