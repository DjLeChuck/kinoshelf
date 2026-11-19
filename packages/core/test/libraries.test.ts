import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type Config, type LibraryConfig } from '../src/config/config.js';
import {
  destinationRoots,
  libraryId,
  libraryOverrides,
  libraryProfile,
  watchedFolders,
} from '../src/config/libraries.js';
import { buildProfile } from '../src/profiles/build.js';
import { cleanup, makeDir, put } from './workspace.js';

afterEach(cleanup);

const films = { id: 'films', name: 'Films', source: '/m/films', type: 'movie' } as const;
const shows = { id: 'shows', name: 'Shows', source: '/m/shows', type: 'series' } as const;
const arrival = {
  id: 'dl',
  name: 'Downloads',
  source: '/dl',
  into: { movie: 'films', series: 'shows' },
} as const;
const libraries = [films, shows, arrival];

async function load(yaml: string): Promise<Config> {
  const dir = await makeDir();
  await put(join(dir, 'config.yaml'), yaml);
  return loadConfig(dir);
}

describe('libraries', () => {
  it('makes a typed library its own destination and an arrival folder follow its targets', () => {
    expect(libraryOverrides(films, libraries)).toEqual({ dest: '/m/films' });
    expect(
      libraryOverrides({ ...films, naming: 'no-id', metadata: 'nfo', threshold: 90 }, libraries),
    ).toEqual({
      dest: '/m/films',
      naming: 'no-id',
      metadata: 'nfo',
      threshold: 90,
    });
    expect(libraryOverrides({ ...arrival, mode: 'hardlink', threshold: 80 }, libraries)).toEqual({
      destMovies: '/m/films',
      destSeries: '/m/shows',
      mode: 'hardlink',
      threshold: 80,
    });
  });

  it('gives no root, and no fallback, to a kind an arrival folder does not send anywhere', () => {
    expect(libraryOverrides({ ...arrival, into: { movie: 'films' } }, libraries)).toEqual({
      destMovies: '/m/films',
      destSeries: null,
    });
  });

  it('lists the sources of the watched libraries only', () => {
    expect(
      watchedFolders({
        libraries: [{ ...films, watch: true }, { ...shows }, { ...arrival, watch: false }],
      }),
    ).toEqual(['/m/films']);
  });

  it('lists the destinations: typed libraries, never an arrival folder', () => {
    expect(destinationRoots({ libraries })).toEqual(['/m/films', '/m/shows']);
    expect(destinationRoots({})).toEqual([]);
  });

  it('builds a readable id, unique among the others', () => {
    expect(libraryId('Téléchargements → Plex', new Set())).toBe('telechargements-plex');
    expect(libraryId('Films', new Set(['films', 'films-2']))).toBe('films-3');
    expect(libraryId('→→', new Set())).toBe('library');
  });

  describe('config.yaml', () => {
    const rejected = (yaml: string) =>
      expect(load(yaml)).rejects.toMatchObject({ info: { code: 'config.invalid' } });
    const head =
      'libraries:\n  - {id: films, name: Films, source: /f, type: movie}\n' +
      '  - {id: shows, name: Shows, source: /s, type: series}\n';

    it('reads both kinds', async () => {
      const config = await load(
        `${head}  - {id: dl, name: DL, source: /dl, into: {movie: films, series: shows}, mode: copy}\n`,
      );
      expect(config.libraries).toHaveLength(3);
    });

    it('rejects two libraries with the same id', async () => {
      await rejected(`${head}  - {id: films, name: Again, source: /x, type: movie}\n`);
    });

    it('needs exactly one of type and into', async () => {
      await rejected('libraries:\n  - {id: a, name: A, source: /a}\n');
      await rejected(
        `${head}  - {id: a, name: A, source: /a, type: movie, into: {movie: films, series: shows}}\n`,
      );
    });

    it('keeps naming and metadata on typed libraries and the mode on arrival folders', async () => {
      await rejected(
        `${head}  - {id: a, name: A, source: /a, into: {movie: films, series: shows}, naming: no-id}\n`,
      );
      await rejected('libraries:\n  - {id: a, name: A, source: /a, type: movie, mode: copy}\n');
    });

    it('reads a typed library’s own names, checks them, and refuses them on an arrival folder', async () => {
      const config = await load(
        `${head}  - {id: a, name: A, source: /a, type: movie, names: {movieFolder: '{title} ({year})', movieFile: '{title} ({year}) {screenSize}'}}\n`,
      );
      const library = config.libraries?.[2];
      expect(library?.names).toEqual({
        movieFolder: '{title} ({year})',
        movieFile: '{title} ({year}) {screenSize}',
      });
      expect(libraryOverrides(library as LibraryConfig, config.libraries ?? []).names).toEqual(
        library?.names,
      );
      expect(buildProfile(libraryProfile(library, {})).templates.movieFile).toBe(
        '{title} ({year}) {screenSize}',
      );
      await rejected(
        `${head}  - {id: a, name: A, source: /a, type: movie, names: {movieFolder: '{title}', movieFile: '{year}'}}\n`,
      );
      await rejected(
        `${head}  - {id: a, name: A, source: /a, type: movie, names: {movieFolder: '{title}', movieFile: '{title} {x}'}}\n`,
      );
      await rejected(
        `${head}  - {id: a, name: A, source: /a, type: movie, names: {movieFile: '{title}'}}\n`,
      );
      await rejected(
        `${head}  - {id: a, name: A, source: /a, into: {movie: films}, names: {movieFolder: '{title}', movieFile: '{title}'}}\n`,
      );
    });

    it('needs into to name existing libraries of the right type', async () => {
      await rejected(
        `${head}  - {id: a, name: A, source: /a, into: {movie: nope, series: shows}}\n`,
      );
      await rejected(
        `${head}  - {id: a, name: A, source: /a, into: {movie: shows, series: films}}\n`,
      );
    });

    it('lets an arrival folder send to one kind only, but not to none', async () => {
      const movies = await load(`${head}  - {id: a, name: A, source: /a, into: {movie: films}}\n`);
      expect(movies.libraries?.[2]?.into).toEqual({ movie: 'films' });
      await load(`${head}  - {id: a, name: A, source: /a, into: {series: shows}}\n`);
      await rejected(`${head}  - {id: a, name: A, source: /a, into: {}}\n`);
    });

    it('no longer reads a global destination or watch.folders', async () => {
      await rejected('destination: /media\n');
      await rejected('watch:\n  folders: [/dl]\n');
    });
  });
});
