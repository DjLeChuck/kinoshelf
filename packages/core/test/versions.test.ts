import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPlan,
  executePlan,
  GuessitParser,
  KinoshelfError,
  loadBundledProfile,
  MemoryJournal,
  parseProfile,
  undoLastBatch,
  type MovieDetails,
  type PlanInput,
  type PlanItem,
  type Profile,
} from '../src/index.js';
import { movie } from './fake-provider.js';
import { cleanup, counter, makeDir, put } from './workspace.js';

afterEach(cleanup);

const parser = new GuessitParser();
const plex = await loadBundledProfile('plex');
const jellyfin = await loadBundledProfile('jellyfin');
const nightbitch = movie(728949, 'Nightbitch', 2024);

const details: MovieDetails = {
  kind: 'movie',
  id: { provider: 'tmdb', id: 728949 },
  title: 'Nightbitch',
  originalTitle: 'Nightbitch',
  genres: [],
  studios: [],
  countries: [],
  cast: [],
  directors: [],
  writers: [],
  posterPath: '/poster.jpg',
  backdropPath: '/backdrop.jpg',
};

const input = (path: string, withDetails = false): PlanInput => ({
  parsed: parser.parse(path),
  candidate: nightbitch,
  ...(withDetails && { details }),
});

const plan = (inputs: PlanInput[], lib: string, profile: Profile = plex) =>
  createPlan(inputs, {
    profile,
    destinationRoot: lib,
    mode: 'copy',
    imageUrl: (path, size) => `https://img.test/${size}${path}`,
    newId: counter(),
  });

const names = (item: PlanItem | undefined): string[] =>
  (item?.operations ?? []).map((op) => op.destination.split('/').pop() ?? '');

const FOLDER = 'Nightbitch (2024) {tmdb-728949}';

/** A Kodi-style profile that keeps several versions, with a folder poster and a `movie.nfo`. */
const kodiProfile = parseProfile(`
id: kodi
name: Kodi
episodeRangeSeparator: '-e'
templates:
  movieFolder: '{title} ({year})'
  movieFile: '{title} ({year})'
  movieVersion: ' - {version}'
  seriesFolder: '{title}'
  seasonFolder: 'Season {season:02}'
  episodeFile: '{title} - s{season:02}e{episode:02}'
nfo: { format: kodi, movie: movie.nfo, episode: '{file}.nfo' }
artwork:
  - { kind: poster, name: poster.jpg }
filesystem: { forbidden: posix, replacement: '', maxSegmentBytes: 255 }
`);
const image = () => Promise.resolve(new Uint8Array([1, 2, 3]));

describe('several qualities of one movie', () => {
  it('names a movie that arrives with its quality', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const file = await put(join(src, 'Nightbitch.2024.1080p.WEB-DL-GRP.mkv'));

    const { items } = await plan([input(file)], lib);

    expect(items[0]?.status).toBe('ready');
    expect(items[0]?.operations[0]).toMatchObject({
      destination: join(lib, FOLDER, `${FOLDER} - 1080p.mkv`),
    });
  });

  it('puts two qualities side by side in one folder, whatever their order', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const low = await put(join(src, 'a', 'Nightbitch.2024.1080p.WEB-DL-GRP.mkv'));
    const high = await put(join(src, 'b', 'Nightbitch.2024.2160p.WEB-DL-GRP.mkv'));

    for (const order of [
      [low, high],
      [high, low],
    ] as const) {
      const { items } = await plan(
        order.map((path) => input(path)),
        lib,
      );
      expect(items.map((item) => item.status)).toEqual(['ready', 'ready']);
      expect(items.flatMap(names).sort()).toEqual([
        `${FOLDER} - 1080p.mkv`,
        `${FOLDER} - 2160p.mkv`,
      ]);
    }
  });

  it('tells two files of the same size apart by their source, then their group', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const web = await put(join(src, 'a', 'Nightbitch.2024.1080p.WEB-DL-AAA.mkv'));
    const disc = await put(join(src, 'b', 'Nightbitch.2024.1080p.BluRay-AAA.mkv'));
    const other = await put(join(src, 'c', 'Nightbitch.2024.1080p.BluRay-BBB.mkv'));

    const { items } = await plan([input(web), input(disc), input(other)], lib);

    expect(items.flatMap(names)).toEqual([
      `${FOLDER} - 1080p Web AAA.mkv`,
      `${FOLDER} - 1080p Blu-ray AAA.mkv`,
      `${FOLDER} - 1080p Blu-ray BBB.mkv`,
    ]);
  });

  it('holds back files nothing can tell apart, rather than numbering them', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const one = await put(join(src, 'a', 'Nightbitch.2024.1080p.WEB-DL-GRP.mkv'));
    const two = await put(join(src, 'b', 'Nightbitch.2024.1080p.WEB-DL-GRP.mkv'));

    const { items } = await plan([input(one), input(two)], lib);

    expect(items.map((item) => item.status)).toEqual(['conflict', 'conflict']);
    expect(items[0]?.conflicts[0]?.reason).toBe('duplicate-destination');
  });

  it('adds nothing to a file that never says its size', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const file = await put(join(src, 'Nightbitch.2024.mkv'));

    const { items } = await plan([input(file)], lib);

    expect(names(items[0])).toEqual([`${FOLDER}.mkv`]);
  });

  it('follows the quality with its subtitles', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const file = await put(join(src, 'Nightbitch.2024.2160p.WEB-DL-GRP.mkv'));
    await put(join(src, 'Nightbitch.2024.2160p.WEB-DL-GRP.en.srt'));

    const { items } = await plan([input(file)], lib);

    expect(names(items[0])).toEqual([`${FOLDER} - 2160p.mkv`, `${FOLDER} - 2160p.en.srt`]);
  });

  it('goes on to the source when the same size is already on the disk', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    await put(join(lib, FOLDER, `${FOLDER} - 1080p.mkv`), 'the web release');
    const file = await put(join(src, 'Nightbitch.2024.1080p.BluRay-GRP.mkv'), 'a disc');

    const { items } = await plan([input(file)], lib);

    expect(items[0]?.status).toBe('ready');
    expect(names(items[0])).toEqual([`${FOLDER} - 1080p Blu-ray.mkv`]);
  });

  it('holds back a file the size of the one already there: the same release again', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    await put(join(lib, FOLDER, `${FOLDER} - 1080p.mkv`), 'same bytes');
    const file = await put(join(src, 'Nightbitch.2024.1080p.WEB-DL-GRP.mkv'), 'same bytes');

    const { items } = await plan([input(file)], lib);

    expect(items[0]?.status).toBe('conflict');
    expect(items[0]?.conflicts[0]?.reason).toBe('destination-exists');
  });

  it('leaves alone a file the library already holds, with or without a quality', async () => {
    const lib = await makeDir();
    const plain = await put(join(lib, FOLDER, `${FOLDER}.1080p.mkv`.replace('.1080p', '')));
    const named = await put(join(lib, FOLDER, `${FOLDER} - 2160p.mkv`));

    const { items } = await plan([input(plain), input(named)], lib);

    expect(items.map((item) => item.status)).toEqual(['in-place', 'in-place']);
  });

  it('keeps the profile’s old behaviour when it has no version template', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const file = await put(join(src, 'Nightbitch.2024.1080p.WEB-DL-GRP.mkv'));
    const templates: Profile['templates'] = {
      movieFolder: plex.templates.movieFolder,
      movieFile: plex.templates.movieFile,
      seriesFolder: plex.templates.seriesFolder,
      seasonFolder: plex.templates.seasonFolder,
      episodeFile: plex.templates.episodeFile,
    };

    const { items } = await plan([input(file)], lib, { ...plex, templates });

    expect(names(items[0])).toEqual([`${FOLDER}.mkv`]);
  });

  it('keeps the name inside the byte limit, quality included', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const file = await put(join(src, 'Long.2024.2160p.WEB-DL-GRP.mkv'));
    const long = movie(1, '劇場版'.repeat(30), 2024);

    const { items } = await plan([{ parsed: parser.parse(file), candidate: long }], lib);

    const name = names(items[0])[0] ?? '';
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(255);
    expect(name.endsWith(' - 2160p.mkv')).toBe(true);
  });

  it('starts every version with the folder’s name for Jellyfin', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const file = await put(join(src, 'Nightbitch.2024.2160p.WEB-DL-GRP.mkv'));

    const { items } = await plan([input(file)], lib, jellyfin);

    const [folder, name] = (items[0]?.operations[0]?.destination ?? '').split('/').slice(-2);
    expect(folder).toBe('Nightbitch (2024) [tmdbid-728949]');
    expect(name).toBe(`${folder} - 2160p.mkv`);
  });

  describe('beside the video', () => {
    it('writes the folder’s poster and fanart once, whatever the number of versions', async () => {
      const [src, lib] = [await makeDir(), await makeDir()];
      const low = await put(join(src, 'a', 'Nightbitch.2024.1080p.WEB-DL-GRP.mkv'));
      const high = await put(join(src, 'b', 'Nightbitch.2024.2160p.WEB-DL-GRP.mkv'));
      const profile = kodiProfile;

      const { items } = await plan([input(low, true), input(high, true)], lib, profile);

      const written = items.flatMap(names).filter((name) => !name.endsWith('.mkv'));
      expect(written.sort()).toEqual(['movie.nfo', 'poster.jpg']);
    });

    it('undoes one version without touching the other', async () => {
      const [src, lib] = [await makeDir(), await makeDir()];
      const low = await put(join(src, 'a', 'Nightbitch.2024.1080p.WEB-DL-GRP.mkv'), 'low');
      const high = await put(join(src, 'b', 'Nightbitch.2024.2160p.WEB-DL-GRP.mkv'), 'high');
      const journal = new MemoryJournal();

      for (const path of [low, high]) {
        await executePlan(await plan([input(path)], lib), { journal });
      }
      expect(await readdir(join(lib, FOLDER))).toHaveLength(2);

      await undoLastBatch(journal);

      expect(await readdir(join(lib, FOLDER))).toEqual([`${FOLDER} - 1080p.mkv`]);
    });
  });
});

describe('the files two versions share', () => {
  const arrive = async (path: string, lib: string, journal: MemoryJournal) =>
    executePlan(await plan([input(path, true)], lib, kodiProfile), {
      journal,
      fetchImage: image,
    });

  it('are written by the first version, and left alone when the second is undone', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const low = await put(join(src, 'a', 'Nightbitch.2024.1080p.WEB-DL-GRP.mkv'), 'low');
    const high = await put(join(src, 'b', 'Nightbitch.2024.2160p.WEB-DL-GRP.mkv'), 'high');
    const journal = new MemoryJournal();
    const folder = join(lib, 'Nightbitch (2024)');

    await arrive(low, lib, journal);
    await arrive(high, lib, journal);
    expect((await readdir(folder)).sort()).toEqual([
      'Nightbitch (2024) - 1080p.mkv',
      'Nightbitch (2024) - 2160p.mkv',
      'movie.nfo',
      'poster.jpg',
    ]);

    await undoLastBatch(journal);

    expect((await readdir(folder)).sort()).toEqual([
      'Nightbitch (2024) - 1080p.mkv',
      'movie.nfo',
      'poster.jpg',
    ]);
  });

  it('keep their folder when a version is renamed inside it', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const file = await put(join(src, 'Nightbitch.2024.mkv'), 'video');
    const journal = new MemoryJournal();
    const folder = join(lib, 'Nightbitch (2024)');
    await arrive(file, lib, journal);
    expect((await readdir(folder)).sort()).toEqual([
      'Nightbitch (2024).mkv',
      'movie.nfo',
      'poster.jpg',
    ]);

    // The library now names the version of what it holds: a move within the same folder.
    const parsed = { ...parser.parse(join(folder, 'Nightbitch (2024).mkv')), screenSize: '1080p' };
    await executePlan(
      await createPlan([{ parsed, candidate: nightbitch, details, applyVersion: true }], {
        profile: kodiProfile,
        destinationRoot: lib,
        mode: 'move',
        newId: counter(),
      }),
      { journal, fetchImage: image },
    );

    expect((await readdir(folder)).sort()).toEqual([
      'Nightbitch (2024) - 1080p.mkv',
      'movie.nfo',
      'poster.jpg',
    ]);
  });
});

describe('naming a version on request', () => {
  const forced = (path: string, screenSize?: string): PlanInput => ({
    parsed: { ...parser.parse(path), ...(screenSize !== undefined && { screenSize }) },
    candidate: nightbitch,
    applyVersion: true,
  });
  const move = (inputs: PlanInput[], lib: string) =>
    createPlan(inputs, { profile: plex, destinationRoot: lib, mode: 'move', newId: counter() });

  it('renames a file the library already holds, its subtitles with it', async () => {
    const lib = await makeDir();
    const file = await put(join(lib, FOLDER, `${FOLDER}.mkv`));
    await put(join(lib, FOLDER, `${FOLDER}.en.srt`));

    const { items } = await move([forced(file, '1080p')], lib);

    expect(items[0]?.status).toBe('ready');
    expect(
      items[0]?.operations.map((op) => [op.type === 'transfer' && op.mode, op.destination]),
    ).toEqual([
      ['move', join(lib, FOLDER, `${FOLDER} - 1080p.mkv`)],
      ['move', join(lib, FOLDER, `${FOLDER} - 1080p.en.srt`)],
    ]);
  });

  it('is undone by putting the old name back', async () => {
    const lib = await makeDir();
    const file = await put(join(lib, FOLDER, `${FOLDER}.mkv`), 'video');
    const journal = new MemoryJournal();

    await executePlan(await move([forced(file, '2160p')], lib), { journal });
    expect(await readdir(join(lib, FOLDER))).toEqual([`${FOLDER} - 2160p.mkv`]);

    await undoLastBatch(journal);
    expect(await readdir(join(lib, FOLDER))).toEqual([`${FOLDER}.mkv`]);
  });

  it('has nothing to do for a file that already carries its version', async () => {
    const lib = await makeDir();
    const file = await put(join(lib, FOLDER, `${FOLDER} - 1080p.mkv`));

    const { items } = await move([forced(file, '1080p')], lib);

    expect(items[0]?.status).toBe('in-place');
  });

  it('refuses a file whose name says no size, rather than guessing', async () => {
    const lib = await makeDir();
    const file = await put(join(lib, FOLDER, `${FOLDER}.mkv`));

    const { items } = await move([forced(file)], lib);

    expect(items[0]?.status).toBe('conflict');
    expect(items[0]?.conflicts[0]).toMatchObject({
      reason: 'unresolvable-name',
      detail: { code: 'plan.version-unavailable' },
    });
  });

  it('refuses a profile that has no naming for versions', async () => {
    const lib = await makeDir();
    const file = await put(join(lib, FOLDER, `${FOLDER}.mkv`));
    const templates: Profile['templates'] = {
      movieFolder: plex.templates.movieFolder,
      movieFile: plex.templates.movieFile,
      seriesFolder: plex.templates.seriesFolder,
      seasonFolder: plex.templates.seasonFolder,
      episodeFile: plex.templates.episodeFile,
    };

    const { items } = await createPlan([forced(file, '1080p')], {
      profile: { ...plex, templates },
      destinationRoot: lib,
      mode: 'move',
    });

    expect(items[0]?.status).toBe('conflict');
  });
});

describe('a profile’s version template', () => {
  const withVersion = (version: string) =>
    parseProfile(`
id: custom
name: Custom
episodeRangeSeparator: '-e'
templates:
  movieFolder: '{title}'
  movieFile: '{title}'
  movieVersion: '${version}'
  seriesFolder: '{title}'
  seasonFolder: 'Season {season:02}'
  episodeFile: '{title} - s{season:02}e{episode:02}'
filesystem: { forbidden: posix, replacement: '', maxSegmentBytes: 255 }
`);

  it('accepts {version}', () => {
    expect(withVersion(' [{version}]').templates.movieVersion).toBe(' [{version}]');
  });

  it('rejects any other variable', () => {
    expect(() => withVersion(' {year}')).toThrow(KinoshelfError);
  });

  it('rejects a folder', () => {
    expect(() => withVersion('/{version}')).toThrow(KinoshelfError);
  });
});
