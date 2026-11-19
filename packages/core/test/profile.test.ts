import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KinoshelfError,
  buildProfile,
  checkNaming,
  loadProfileFile,
  parseProfile,
  parseTemplate,
  renderTemplate,
} from '../src/index.js';
import type { Metadata, Naming, Profile, TemplateVariables } from '../src/index.js';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof KinoshelfError ? error.info.code : 'unexpected';
  }
  return undefined;
}

function path(
  profile: Profile,
  key: Exclude<keyof Profile['templates'], 'movieVersion' | 'episodeVersion'>,
  vars: TemplateVariables,
) {
  return renderTemplate(parseTemplate(profile.templates[key]), vars, {
    rules: profile.filesystem,
    rangeSeparator: profile.episodeRangeSeparator,
  });
}

const base = `
id: test
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

const profileOf = (naming: Naming, metadata: Metadata): Profile =>
  buildProfile({ naming, metadata });

describe('buildProfile naming', () => {
  const vars = { title: 'The Bear', year: 2022, tmdb: 136315, season: 3, episode: 4 };

  it('with-id tags the id in braces, in the folders and in the movie file', () => {
    const profile = profileOf('with-id', 'none');
    expect(path(profile, 'movieFolder', vars)).toEqual(['The Bear (2022) {tmdb-136315}']);
    // Jellyfin wants the file to start with its folder's name.
    expect(path(profile, 'movieFile', vars)).toEqual(path(profile, 'movieFolder', vars));
    expect(path(profile, 'seriesFolder', vars)).toEqual(['The Bear (2022) {tmdb-136315}']);
    expect(path(profile, 'seasonFolder', vars)).toEqual(['Season 03']);
    expect(path(profile, 'episodeFile', vars)).toEqual(['The Bear (2022) - s03e04']);
  });

  it('no-id leaves the id out of every name', () => {
    const profile = profileOf('no-id', 'none');
    expect(path(profile, 'movieFolder', vars)).toEqual(['The Bear (2022)']);
    expect(path(profile, 'movieFile', vars)).toEqual(['The Bear (2022)']);
    expect(path(profile, 'seriesFolder', vars)).toEqual(['The Bear (2022)']);
    expect(path(profile, 'episodeFile', vars)).toEqual(['The Bear (2022) - s03e04']);
  });

  it('renders specials and double episodes', () => {
    const profile = profileOf('with-id', 'none');
    const grey = { title: 'Grey’s Anatomy', year: 2005, tmdb: 1416, season: 2 };
    expect(path(profile, 'seasonFolder', { ...grey, season: 0 })).toEqual(['Season 00']);
    expect(path(profile, 'episodeFile', { ...grey, episode: [1, 3] })).toEqual([
      'Grey’s Anatomy (2005) - s02e01-e03',
    ]);
  });

  it('names every episode alike whatever the choices', () => {
    const names = (['with-id', 'no-id'] as const).flatMap((naming) =>
      (['none', 'nfo'] as const).map((metadata) =>
        path(profileOf(naming, metadata), 'episodeFile', vars),
      ),
    );
    expect(new Set(names.map((name) => name.join('/'))).size).toBe(1);
  });

  it('identifies the choice', () => {
    expect(profileOf('no-id', 'nfo').id).toBe('no-id.nfo');
  });
});

describe('buildProfile metadata', () => {
  it('none writes no NFO and no artwork', () => {
    for (const naming of ['with-id', 'no-id'] as const) {
      const profile = profileOf(naming, 'none');
      expect(profile.nfo).toBeNull();
      expect(profile.artwork).toEqual([]);
    }
  });

  it('nfo writes Kodi NFO and the images all the players read', () => {
    for (const naming of ['with-id', 'no-id'] as const) {
      const profile = profileOf(naming, 'nfo');
      expect(profile.nfo).toEqual({
        format: 'kodi',
        movie: 'movie.nfo',
        episode: '{file}.nfo',
        series: 'tvshow.nfo',
      });
      expect(profile.artwork.map(({ kind, name, size }) => [kind, name, size])).toEqual([
        ['poster', 'poster.jpg', 'standard'],
        ['fanart', 'fanart.jpg', 'original'],
        ['logo', 'clearlogo.png', 'original'],
        ['season-poster', 'season{season:02}-poster.jpg', 'standard'],
        ['episode-thumb', '{file}-thumb.jpg', 'original'],
      ]);
      expect(profile.artwork[3]?.specialsName).toBe('season-specials-poster.jpg');
    }
  });

  it('is a profile the YAML loader would accept (the two stay in step)', () => {
    // Everything a built profile uses must be known to the validation a custom file goes through.
    const profile = profileOf('with-id', 'nfo');
    const yaml = [
      'id: built',
      `episodeRangeSeparator: '${profile.episodeRangeSeparator}'`,
      'templates:',
      ...Object.entries(profile.templates).map(([key, value]) => `  ${key}: '${value}'`),
      'nfo:',
      '  format: kodi',
      `  movie: ${profile.nfo?.movie ?? ''}`,
      `  episode: '${profile.nfo?.episode ?? ''}'`,
      `  series: ${profile.nfo?.series ?? ''}`,
      'artwork:',
      ...profile.artwork.map(
        (a) =>
          `  - { kind: ${a.kind}, name: '${a.name}', size: ${a.size}${
            a.specialsName === undefined ? '' : `, specialsName: ${a.specialsName}`
          } }`,
      ),
      'filesystem:',
      `  forbidden: ${profile.filesystem.forbidden}`,
      "  replacement: ''",
      `  maxSegmentBytes: ${String(profile.filesystem.maxSegmentBytes)}`,
      '',
    ].join('\n');
    expect(parseProfile(yaml)).toEqual({ ...profile, id: 'built' });
  });
});

describe('parseProfile', () => {
  it('accepts a minimal valid profile', () => {
    expect(parseProfile(base).nfo).toBeNull();
  });

  it('keeps the specials name of a season poster, and refuses it elsewhere', () => {
    const artwork = (spec: string) => `${base}artwork:\n  - ${spec}\n`.replace('nfo: null\n', '');
    const ok = parseProfile(
      artwork("{ kind: season-poster, name: 'S{season:02}.jpg', specialsName: specials.jpg }"),
    );
    expect(ok.artwork[0]?.specialsName).toBe('specials.jpg');
    expect(() =>
      parseProfile(artwork('{ kind: poster, name: poster.jpg, specialsName: specials.jpg }')),
    ).toThrow();
    expect(
      codeOf(() =>
        parseProfile(
          artwork(
            "{ kind: season-poster, name: 'S{season:02}.jpg', specialsName: '{season}.jpg' }",
          ),
        ),
      ),
    ).toBe('profile.unknown-variable');
  });

  it('serves a logo at its original size only', () => {
    const artwork = (spec: string) => `${base}artwork:\n  - ${spec}\n`;
    expect(parseProfile(artwork('{ kind: logo, name: logo.png }')).artwork[0]?.size).toBe(
      'original',
    );
    expect(() => parseProfile(artwork('{ kind: logo, name: logo.png, size: standard }'))).toThrow();
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

  it('takes a replacement that stays inside a name, and nothing else', () => {
    const withReplacement = (value: string) =>
      base.replace(`replacement: ''`, `replacement: '${value}'`);
    expect(parseProfile(withReplacement('_')).filesystem.replacement).toBe('_');
    expect(parseProfile(withReplacement(' - ')).filesystem.replacement).toBe(' - ');
    for (const value of ['/', '../', '\\', ':', 'abcde']) {
      expect(codeOf(() => parseProfile(withReplacement(value)))).toBe('profile.invalid');
    }
  });

  it('allows an empty movie folder (flat layout) but not an empty series folder', () => {
    expect(
      parseProfile(base.replace(`movieFolder: '{title}'`, `movieFolder: ''`)).templates.movieFolder,
    ).toBe('');
    expect(
      codeOf(() => parseProfile(base.replace(`seriesFolder: '{title}'`, `seriesFolder: ''`))),
    ).toBe('profile.invalid');
  });

  it('never quotes the content of the file in a YAML error', () => {
    try {
      parseProfile('SECRET_TOKEN: abc: def\n');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(KinoshelfError);
      expect(JSON.stringify((error as KinoshelfError).info)).not.toContain('SECRET_TOKEN');
    }
  });

  it('reads only an existing, small .yaml file as a profile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kinoshelf-profile-'));
    try {
      const notYaml = join(dir, 'passwd');
      await writeFile(notYaml, 'root:x:0:0:root:/root:/bin/bash\n');
      const huge = join(dir, 'huge.yaml');
      await writeFile(huge, `# ${'x'.repeat(70 * 1024)}\n`);
      for (const path of [notYaml, huge, '/dev/zero', join(dir, 'missing.yaml'), dir]) {
        await expect(loadProfileFile(path)).rejects.toMatchObject({
          info: { code: 'profile.not-a-file' },
        });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

describe('loadProfileFile: parsed once', () => {
  it('serves a profile again until its file changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kinoshelf-profile-'));
    try {
      const file = join(directory, 'mine.yaml');
      const text = base;
      await writeFile(file, text);
      const first = await loadProfileFile(file);
      expect(await loadProfileFile(file)).toBe(first);

      await writeFile(file, text.replace(/^id: .*$/m, 'id: edited'));
      await utimes(file, new Date(), new Date(Date.now() + 5000));
      const edited = await loadProfileFile(file);
      expect(edited).not.toBe(first);
      expect(edited.id).toBe('edited');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('checkNaming', () => {
  const movie = (movieFile: string, movieFolder = '{title} ({year})') => ({
    movieFolder,
    movieFile,
  });
  const show = {
    seriesFolder: '{title} ({year})',
    seasonFolder: 'Season {season:02}',
    episodeFile: '{title} ({year}) - s{season:02}e{episode:02}',
  };

  it('previews a template with everything given, and with only the work', () => {
    const report = checkNaming({
      ...movie(
        '{title} ({year}) {screenSize} [imdbid-{imdb}] [tmdbtvid-{tmdb}]',
        '{title} ({year}) [imdbid-{imdb}] [tmdbtvid-{tmdb}]',
      ),
      ...show,
    });
    expect(report.preview.complete.movie.path).toEqual([
      'Dune (2021) [imdbid-tt1160419] [tmdbtvid-438631]',
      'Dune (2021) 2160p [imdbid-tt1160419] [tmdbtvid-438631].mkv',
    ]);
    expect(report.preview.bare.movie.path).toEqual([
      'Dune (2021) [tmdbtvid-438631]',
      'Dune (2021) [tmdbtvid-438631].mkv',
    ]);
    expect(report.preview.complete.episode.path).toEqual([
      'Dune (2021)',
      'Season 01',
      'Dune (2021) - s01e02.mkv',
    ]);
    // The issue's own structure: the file does not start with its folder's name (Jellyfin's rule).
    expect(report.warnings.map((warning) => warning.code)).toEqual([
      'movie-file-not-in-folder-name',
    ]);
    expect(checkNaming(movie('{title} ({year}) {screenSize} [imdbid-{imdb}]')).warnings).toEqual(
      [],
    );
  });

  it('accepts the variables the file itself tells, in a file name only', () => {
    expect(
      codeOf(() => checkNaming(movie('{title} ({year}) {audioCodec} {videoCodec} [{hdr}]'))),
    ).toBeUndefined();
    expect(codeOf(() => checkNaming(movie('{title}', '{title} {hdr}')))).toBe(
      'profile.unknown-variable',
    );
  });

  it('shows the default names of a type that is not customised', () => {
    const report = checkNaming(movie('{title} ({year}) {screenSize}'));
    expect(report.preview.complete.episode.path).toEqual([
      'Dune (2021)',
      'Season 01',
      'Dune (2021) - s01e02.mkv',
    ]);
  });

  it('warns, without refusing, when a movie file does not start with its folder’s name', () => {
    const report = checkNaming(movie('{title} - {year}'));
    expect(report.warnings.map((warning) => warning.code)).toEqual([
      'movie-file-not-in-folder-name',
    ]);
  });

  it('wants every name of a type once one is set', () => {
    expect(codeOf(() => checkNaming({ movieFile: '{title}' }))).toBe('profile.names-incomplete');
    expect(codeOf(() => checkNaming({ movieFolder: '{title}' }))).toBe('profile.names-incomplete');
    expect(codeOf(() => checkNaming({ seasonFolder: 'Season {season}' }))).toBe(
      'profile.names-incomplete',
    );
    expect(
      codeOf(() => checkNaming({ seriesFolder: '{title}', episodeFile: '{title} {episode}' })),
    ).toBe('profile.names-incomplete');
    expect(codeOf(() => checkNaming({ ...movie('{title}') }))).toBeUndefined();
    expect(codeOf(() => checkNaming({ ...show }))).toBeUndefined();
  });

  it('refuses a name that would give two works the same one', () => {
    expect(codeOf(() => checkNaming(movie('{year}')))).toBe('profile.name-not-unique');
    expect(codeOf(() => checkNaming({ ...show, seasonFolder: 'Saison' }))).toBe(
      'profile.name-not-unique',
    );
    expect(codeOf(() => checkNaming({ ...show, episodeFile: '{title} {season:02}' }))).toBe(
      'profile.name-not-unique',
    );
  });

  it('refuses an unknown variable, one a folder cannot have, and a path that leaves the library', () => {
    expect(codeOf(() => checkNaming(movie('{title} {nope}')))).toBe('profile.unknown-variable');
    // A folder holds several versions: only a file may say the picture size.
    expect(codeOf(() => checkNaming(movie('{title}', '{title} {screenSize}')))).toBe(
      'profile.unknown-variable',
    );
    expect(codeOf(() => checkNaming(movie('{title}', '../{title}')))).toBe('profile.invalid-path');
    expect(codeOf(() => checkNaming(movie('{title}', '/{title}')))).toBe('profile.invalid-path');
    expect(codeOf(() => checkNaming(movie('{title}/{year}')))).toBe('profile.invalid-path');
    // A slash hidden in a group is a slash all the same.
    expect(codeOf(() => checkNaming(movie('{title} [../{imdb}]')))).toBe('profile.invalid-path');
  });

  it('is applied by buildProfile over the naming axis, one type at a time', () => {
    const profile = buildProfile({ naming: 'with-id', metadata: 'none', names: show });
    expect(profile.templates.seasonFolder).toBe('Season {season:02}');
    expect(profile.templates.seriesFolder).toBe('{title} ({year})');
    // The other type keeps the naming axis, and its labels.
    expect(profile.templates.movieFolder).toBe('{title} ({year}) \\{tmdb-{tmdb}\\}');
    expect(profile.templates.movieVersion).toBe(' - {version}');
    // The customised one is left as written.
    expect(profile.templates.episodeVersion).toBeUndefined();
  });

  it('leaves a type as written as soon as one of its names is set', () => {
    // checkNaming refuses a partial set; buildProfile must still never label what is the owner's.
    const profile = buildProfile({
      naming: 'no-id',
      metadata: 'none',
      names: { movieFile: '{title} ({year}) {screenSize}' },
    });
    expect(profile.templates.movieVersion).toBeUndefined();
    expect(profile.templates.episodeVersion).toBe(' - {version}');
  });
});
