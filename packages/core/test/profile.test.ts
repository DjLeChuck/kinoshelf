import { describe, expect, it } from 'vitest';
import {
  KinoshelfError,
  listBundledProfiles,
  loadBundledProfile,
  loadProfileFile,
  parseProfile,
  parseTemplate,
  renderTemplate,
} from '../src/index.js';
import type { Profile, TemplateVariables } from '../src/index.js';

const plexUrl = new URL('../profiles/plex.yaml', import.meta.url);
const plexNoIdUrl = new URL('../profiles/plex-no-id.yaml', import.meta.url);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof KinoshelfError ? error.info.code : 'unexpected';
  }
  return undefined;
}

function path(profile: Profile, key: keyof Profile['templates'], vars: TemplateVariables) {
  return renderTemplate(parseTemplate(profile.templates[key]), vars, {
    rules: profile.filesystem,
    rangeSeparator: profile.episodeRangeSeparator,
  });
}

const base = `
id: test
name: Test
episodeRangeSeparator: '-e'
templates:
  movieFolder: '{title}'
  movieFile: '{title}'
  seriesFolder: '{title}'
  seasonFolder: 'Season {season:02}'
  episodeFile: '{title} - s{season:02}e{episode:02}'
filesystem:
  forbidden: posix
  replacement: ''
  maxSegmentBytes: 255
`;

describe('plex profile', () => {
  it('writes no NFO and no artwork', async () => {
    const plex = await loadProfileFile(plexUrl);
    expect(plex.id).toBe('plex');
    expect(plex.nfo).toBeNull();
    expect(plex.artwork).toEqual([]);
  });

  it('renders the movie layout from the Plex documentation', async () => {
    const plex = await loadProfileFile(plexUrl);
    const vars = { title: 'Dune', year: 2021, tmdb: 438631 };
    expect(path(plex, 'movieFolder', vars)).toEqual(['Dune (2021) {tmdb-438631}']);
    expect(path(plex, 'movieFile', vars)).toEqual(['Dune (2021) {tmdb-438631}']);
  });

  it('renders the series layout: id in the series folder only', async () => {
    const plex = await loadProfileFile(plexUrl);
    const vars = { title: 'The Bear', year: 2022, tmdb: 136315, season: 3, episode: 4 };
    expect(path(plex, 'seriesFolder', vars)).toEqual(['The Bear (2022) {tmdb-136315}']);
    expect(path(plex, 'seasonFolder', vars)).toEqual(['Season 03']);
    expect(path(plex, 'episodeFile', vars)).toEqual(['The Bear (2022) - s03e04']);
  });

  it('renders specials and double episodes', async () => {
    const plex = await loadProfileFile(plexUrl);
    const vars = { title: 'Grey’s Anatomy', year: 2005, tmdb: 1416, season: 2 };
    expect(path(plex, 'seasonFolder', { ...vars, season: 0 })).toEqual(['Season 00']);
    expect(path(plex, 'episodeFile', { ...vars, episode: [1, 3] })).toEqual([
      'Grey’s Anatomy (2005) - s02e01-e03',
    ]);
  });
});

describe('plex-no-id profile', () => {
  it('leaves the id out of every name', async () => {
    const profile = await loadProfileFile(plexNoIdUrl);
    const vars = { title: 'The Bear', year: 2022, tmdb: 136315, season: 3, episode: 4 };
    expect(profile.id).toBe('plex-no-id');
    expect(path(profile, 'movieFolder', vars)).toEqual(['The Bear (2022)']);
    expect(path(profile, 'movieFile', vars)).toEqual(['The Bear (2022)']);
    expect(path(profile, 'seriesFolder', vars)).toEqual(['The Bear (2022)']);
    expect(path(profile, 'seasonFolder', vars)).toEqual(['Season 03']);
    expect(path(profile, 'episodeFile', vars)).toEqual(['The Bear (2022) - s03e04']);
  });
});

describe('parseProfile', () => {
  it('accepts a minimal valid profile', () => {
    expect(parseProfile(base).nfo).toBeNull();
  });

  it('rejects a double-quoted template with a backslash escape', () => {
    const yaml = base.replace(`movieFolder: '{title}'`, `movieFolder: "{title} \\{tmdb-{tmdb}\\}"`);
    expect(codeOf(() => parseProfile(yaml))).toBe('profile.double-quoted-escape');
  });

  it('rejects unknown variables with the offending field', () => {
    const yaml = base.replace(`movieFile: '{title}'`, `movieFile: '{title} {nope}'`);
    try {
      parseProfile(yaml);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(KinoshelfError);
      expect((error as KinoshelfError).info).toEqual({
        code: 'profile.unknown-variable',
        params: { field: 'templates.movieFile', variable: 'nope' },
      });
    }
  });

  it('rejects variables not allowed in a given template', () => {
    const yaml = base.replace(`seasonFolder: 'Season {season:02}'`, `seasonFolder: '{episode:02}'`);
    expect(codeOf(() => parseProfile(yaml))).toBe('profile.unknown-variable');
  });

  it('rejects slashes in file name templates and path traversal in folders', () => {
    expect(
      codeOf(() => parseProfile(base.replace(`movieFile: '{title}'`, `movieFile: 'a/{title}'`))),
    ).toBe('profile.invalid-path');
    expect(
      codeOf(() =>
        parseProfile(base.replace(`seriesFolder: '{title}'`, `seriesFolder: '../{title}'`)),
      ),
    ).toBe('profile.invalid-path');
  });

  it('allows an empty movie folder (flat layout) but not an empty series folder', () => {
    expect(
      parseProfile(base.replace(`movieFolder: '{title}'`, `movieFolder: ''`)).templates.movieFolder,
    ).toBe('');
    expect(
      codeOf(() => parseProfile(base.replace(`seriesFolder: '{title}'`, `seriesFolder: ''`))),
    ).toBe('profile.invalid');
  });

  it('rejects unknown keys and bad YAML', () => {
    expect(codeOf(() => parseProfile(`${base}extra: 1\n`))).toBe('profile.invalid');
    expect(codeOf(() => parseProfile('id: [unclosed'))).toBe('profile.yaml-syntax');
  });

  it('validates NFO and artwork names', () => {
    const withNfo = `${base}nfo:
  format: kodi
  movie: movie.nfo
  episode: '{file}.nfo'
  series: tvshow.nfo
artwork:
  - { kind: poster, name: poster.jpg }
  - { kind: season-poster, name: 'season{season:02}-poster.jpg' }
`;
    const profile = parseProfile(withNfo);
    expect(profile.nfo?.series).toBe('tvshow.nfo');
    expect(profile.artwork).toHaveLength(2);
    expect(codeOf(() => parseProfile(withNfo.replace('{file}', '{title}')))).toBe(
      'profile.unknown-variable',
    );
  });
});

describe('bundled profiles', () => {
  it('lists the shipped profiles', async () => {
    expect(await listBundledProfiles()).toContain('plex');
  });

  it('loads one by id', async () => {
    expect((await loadBundledProfile('plex')).id).toBe('plex');
  });

  it.each(['nope', '../etc/passwd', 'Plex', '', 'a/b'])(
    'refuses unknown or unsafe id %j',
    async (id) => {
      await expect(loadBundledProfile(id)).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof KinoshelfError && error.info.code === 'profile.unknown',
      );
    },
  );
});
