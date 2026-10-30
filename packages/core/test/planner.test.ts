import { link, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPlan,
  executePlan,
  loadBundledProfile,
  MemoryJournal,
  parseProfile,
  type PlanInput,
  type PlanItem,
  type MovieDetails,
  type Profile,
  type SeriesDetails,
  undoLastBatch,
} from '../src/index.js';
import { movie, series } from './fake-provider.js';
import {
  cleanup,
  counter,
  crossDeviceAvailable,
  makeDir,
  parsedEpisode,
  parsedMovie,
  put,
  SHM,
} from './workspace.js';

const plex = await loadBundledProfile('plex');
const dune = movie(438631, 'Dune', 2021);
const bear = series(136315, 'The Bear', 2022);

afterEach(cleanup);

async function plan(
  inputs: PlanInput[],
  lib: string,
  extra: { mode?: 'copy' | 'hardlink' | 'move'; profile?: Profile } = {},
) {
  return createPlan(inputs, {
    profile: extra.profile ?? plex,
    destinationRoot: lib,
    mode: extra.mode ?? 'copy',
    newId: counter(),
    now: () => new Date('2026-10-28T12:00:00Z'),
  });
}

const destinationOf = (item: PlanItem | undefined): string | undefined => {
  const main = item?.operations[0];
  return main && 'destination' in main ? main.destination : undefined;
};

describe('createPlan: names', () => {
  it('plans a movie into its own folder, with sidecars following', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const source = await put(join(src, 'Dune.2021.2160p.mkv'));
    await put(join(src, 'Dune.2021.2160p.srt'));
    await put(join(src, 'Dune.2021.2160p.en.srt'));
    await put(join(src, 'Dune.2021.2160p.nfo'));
    await put(join(src, 'Other.2020.srt'));

    const result = await plan([{ parsed: parsedMovie(source), candidate: dune }], lib);
    const [item] = result.items;
    const folder = join(lib, 'Dune (2021) {tmdb-438631}');
    const stem = join(folder, 'Dune (2021) {tmdb-438631}');

    expect(item?.status).toBe('ready');
    expect(item?.operations).toEqual([
      { type: 'transfer', mode: 'copy', role: 'main', source, destination: `${stem}.mkv` },
      {
        type: 'transfer',
        mode: 'copy',
        role: 'sidecar',
        source: join(src, 'Dune.2021.2160p.en.srt'),
        destination: `${stem}.en.srt`,
      },
      {
        type: 'transfer',
        mode: 'copy',
        role: 'sidecar',
        source: join(src, 'Dune.2021.2160p.nfo'),
        destination: `${stem}.nfo`,
      },
      {
        type: 'transfer',
        mode: 'copy',
        role: 'sidecar',
        source: join(src, 'Dune.2021.2160p.srt'),
        destination: `${stem}.srt`,
      },
    ]);
  });

  it('records plan metadata', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const source = await put(join(src, 'a.mkv'));
    const result = await plan([{ parsed: parsedMovie(source), candidate: dune }], lib, {
      mode: 'hardlink',
    });
    expect(result).toMatchObject({
      id: 'id-2',
      createdAt: '2026-10-28T12:00:00.000Z',
      profileId: 'plex',
      destinationRoot: lib,
      mode: 'hardlink',
    });
    expect(result.items[0]?.id).toBe('id-1');
    expect(result.items[0]?.externalId).toEqual({ provider: 'tmdb', id: 438631 });
  });

  it('plans an episode under series and season folders', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const source = await put(join(src, 'The.Bear.S03E04.mkv'));
    const result = await plan([{ parsed: parsedEpisode(source, 3, [4]), candidate: bear }], lib);
    expect(destinationOf(result.items[0])).toBe(
      join(lib, 'The Bear (2022) {tmdb-136315}', 'Season 03', 'The Bear (2022) - s03e04.mkv'),
    );
  });

  it('names a double episode with its first and last number, and specials Season 00', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const double = await put(join(src, 'a.avi'));
    const special = await put(join(src, 'b.avi'));
    const result = await plan(
      [
        { parsed: parsedEpisode(double, 2, [1, 2, 3]), candidate: bear },
        { parsed: parsedEpisode(special, 0, [13]), candidate: bear },
      ],
      lib,
    );
    expect(destinationOf(result.items[0])).toMatch(
      /Season 02[\\/]The Bear \(2022\) - s02e01-e03\.avi$/,
    );
    expect(destinationOf(result.items[1])).toMatch(
      /Season 00[\\/]The Bear \(2022\) - s00e13\.avi$/,
    );
  });

  it('lowercases the extension', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const source = await put(join(src, 'FILM.MKV'));
    const result = await plan([{ parsed: parsedMovie(source), candidate: dune }], lib);
    expect(destinationOf(result.items[0])).toMatch(/\.mkv$/);
  });

  it('cleans forbidden characters from titles', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const source = await put(join(src, 'a.mkv'));
    const result = await plan(
      [{ parsed: parsedMovie(source), candidate: movie(1, 'Mission: Impossible?', 1996) }],
      lib,
    );
    expect(destinationOf(result.items[0])).toContain('Mission Impossible (1996) {tmdb-1}');
  });
});

describe('createPlan: separate libraries', () => {
  it('sends movies and series to their own roots', async () => {
    const src = await makeDir();
    const [movies, shows] = [await makeDir(), await makeDir()];
    const film = await put(join(src, 'Dune.2021.mkv'));
    const episode = await put(join(src, 'The.Bear.S03E04.mkv'));

    const result = await createPlan(
      [
        { parsed: parsedMovie(film), candidate: dune },
        { parsed: parsedEpisode(episode, 3, [4]), candidate: bear },
      ],
      {
        profile: plex,
        destinationRoot: { movie: movies, series: shows },
        mode: 'copy',
      },
    );

    expect(
      destinationOf(result.items[0]?.status === 'ready' ? result.items[0] : undefined),
    ).toMatch(new RegExp(`^${movies}/Dune \\(2021\\)`));
    expect(destinationOf(result.items[1])).toMatch(new RegExp(`^${shows}/The Bear \\(2022\\)`));
    expect(result.destinationRoot).toEqual({ movie: movies, series: shows });
  });
});

describe('createPlan: state of the disk', () => {
  it('holds back a file whose destination already exists', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const source = await put(join(src, 'a.mkv'), 'new');
    const existing = await put(
      join(lib, 'Dune (2021) {tmdb-438631}', 'Dune (2021) {tmdb-438631}.mkv'),
      'old',
    );
    const [item] = (await plan([{ parsed: parsedMovie(source), candidate: dune }], lib)).items;
    expect(item).toMatchObject({
      status: 'conflict',
      operations: [],
      conflicts: [{ reason: 'destination-exists', path: existing }],
    });
  });

  it('reports a file already at its target as in-place, not as a conflict', async () => {
    const lib = await makeDir();
    const source = await put(
      join(lib, 'Dune (2021) {tmdb-438631}', 'Dune (2021) {tmdb-438631}.mkv'),
    );
    const [item] = (await plan([{ parsed: parsedMovie(source), candidate: dune }], lib)).items;
    expect(item).toMatchObject({ status: 'in-place', operations: [], conflicts: [] });
  });

  it('reports a hardlink already made as in-place', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const source = await put(join(src, 'a.mkv'));
    const target = join(lib, 'Dune (2021) {tmdb-438631}');
    await put(join(target, '.keep'));
    await link(source, join(target, 'Dune (2021) {tmdb-438631}.mkv'));
    const [item] = (await plan([{ parsed: parsedMovie(source), candidate: dune }], lib)).items;
    expect(item?.status).toBe('in-place');
  });

  it('holds back every file of a batch that targets the same destination', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const [a, b, c] = [
      await put(join(src, 'Dune.1080p.mkv')),
      await put(join(src, 'Dune.2160p.mkv')),
      await put(join(src, 'Other.mkv')),
    ];
    const result = await plan(
      [
        { parsed: parsedMovie(a), candidate: dune },
        { parsed: parsedMovie(b), candidate: dune },
        { parsed: parsedMovie(c), candidate: movie(2, 'Other', 2020) },
      ],
      lib,
    );
    expect(result.items.map((i) => i.status)).toEqual(['conflict', 'conflict', 'ready']);
    expect(result.items[0]?.conflicts[0]?.reason).toBe('duplicate-destination');
  });

  it('treats destinations differing only by case as the same', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const [a, b] = [await put(join(src, 'a.mkv')), await put(join(src, 'b.mkv'))];
    const result = await plan(
      [
        { parsed: parsedMovie(a), candidate: movie(1, 'dune', 2021) },
        { parsed: parsedMovie(b), candidate: movie(1, 'DUNE', 2021) },
      ],
      lib,
    );
    expect(result.items.map((i) => i.status)).toEqual(['conflict', 'conflict']);
  });

  it('is deterministic and writes nothing', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const source = await put(join(src, 'a.mkv'));
    await plan([{ parsed: parsedMovie(source), candidate: dune }], lib);
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(lib)).toEqual([]);
  });
});

describe('createPlan: hardlink and devices', () => {
  it('plans a hardlink on the same filesystem', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const source = await put(join(src, 'a.mkv'));
    const [item] = (
      await plan([{ parsed: parsedMovie(source), candidate: dune }], lib, { mode: 'hardlink' })
    ).items;
    expect(item?.status).toBe('ready');
  });

  it.skipIf(!crossDeviceAvailable)(
    'refuses a hardlink across filesystems, with no fallback',
    async () => {
      const [src, lib] = [await makeDir(), await makeDir(SHM)];
      const source = await put(join(src, 'a.mkv'));
      const [item] = (
        await plan([{ parsed: parsedMovie(source), candidate: dune }], lib, { mode: 'hardlink' })
      ).items;
      expect(item).toMatchObject({
        status: 'conflict',
        operations: [],
        conflicts: [{ reason: 'hardlink-cross-device' }],
      });
    },
  );

  it.skipIf(!crossDeviceAvailable)('still allows copy and move across filesystems', async () => {
    const [src, lib] = [await makeDir(), await makeDir(SHM)];
    const source = await put(join(src, 'a.mkv'));
    for (const mode of ['copy', 'move'] as const) {
      const [item] = (await plan([{ parsed: parsedMovie(source), candidate: dune }], lib, { mode }))
        .items;
      expect(item?.status).toBe('ready');
    }
  });
});

describe('createPlan: names that cannot be built', () => {
  it('holds back a movie without a year, naming the missing variable', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const source = await put(join(src, 'a.mkv'));
    const [item] = (await plan([{ parsed: parsedMovie(source), candidate: movie(9, 'Dune') }], lib))
      .items;
    expect(item).toMatchObject({
      status: 'conflict',
      conflicts: [
        {
          reason: 'unresolvable-name',
          path: source,
          detail: { code: 'template.missing-variable', params: { variable: 'year' } },
        },
      ],
    });
  });

  it('holds back a series match that has no episode numbers', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const source = await put(join(src, 'a.mkv'));
    const [item] = (await plan([{ parsed: parsedEpisode(source, 1, []), candidate: bear }], lib))
      .items;
    expect(item?.conflicts[0]?.detail?.code).toBe('plan.episode-numbers-missing');
  });

  it('refuses a title that would escape the destination', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const source = await put(join(src, 'a.mkv'));
    const posix = parseProfile(`
id: raw
name: Raw
episodeRangeSeparator: '-e'
templates:
  movieFolder: '{title}'
  movieFile: '{title}'
  seriesFolder: '{title}'
  seasonFolder: 'S{season:02}'
  episodeFile: '{title}'
filesystem: { forbidden: posix, replacement: '', maxSegmentBytes: 255 }
`);
    const [item] = (
      await plan([{ parsed: parsedMovie(source), candidate: movie(1, '..', 2021) }], lib, {
        profile: posix,
      })
    ).items;
    expect(item?.conflicts[0]?.detail?.code).toBe('plan.unsafe-segment');
  });
});

const kodi = (extra = '') =>
  parseProfile(`
id: kodi
name: Kodi
episodeRangeSeparator: '-e'
templates:
  movieFolder: '{title} ({year})'
  movieFile: '{title} ({year})'
  seriesFolder: '{title} ({year})'
  seasonFolder: 'Season {season:02}'
  episodeFile: '{title} - s{season:02}e{episode:02}'
nfo: { format: kodi, movie: movie.nfo, episode: '{file}.nfo', series: tvshow.nfo }
artwork:
  - { kind: poster, name: poster.jpg }
  - { kind: fanart, name: fanart.jpg }
  - { kind: season-poster, name: 'season{season:02}-poster.jpg' }
filesystem: { forbidden: posix, replacement: '', maxSegmentBytes: 255 }
${extra}`);

const duneDetails: MovieDetails = {
  kind: 'movie',
  id: { provider: 'tmdb', id: 438631 },
  title: 'Dune',
  originalTitle: 'Dune',
  genres: ['Science Fiction'],
  studios: [],
  countries: [],
  cast: [],
  directors: [],
  writers: [],
  posterPath: '/poster.jpg',
  backdropPath: '/backdrop.jpg',
};

const bearDetails: SeriesDetails = {
  kind: 'series',
  id: { provider: 'tmdb', id: 136315 },
  title: 'The Bear',
  originalTitle: 'The Bear',
  genres: [],
  studios: [],
  countries: [],
  cast: [],
  posterPath: '/show.jpg',
  backdropPath: '/show-bg.jpg',
  seasons: [
    { season: 1, posterPath: '/s1.jpg' },
    { season: 2, posterPath: '/s2.jpg' },
  ],
};

const imageUrl = (path: string, size: string): string => `https://img.test/${size}${path}`;

const companions = (item: PlanItem | undefined) =>
  (item?.operations ?? []).filter((operation) => operation.type !== 'transfer');

describe('createPlan: NFO and artwork', () => {
  const planWith = (inputs: PlanInput[], lib: string, profile = kodi()) =>
    createPlan(inputs, {
      profile,
      destinationRoot: lib,
      mode: 'copy',
      imageUrl,
      newId: counter(),
    });

  it('plans a movie NFO and its images next to the video', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const source = await put(join(src, 'Dune.2021.mkv'));

    const { items } = await planWith(
      [{ parsed: parsedMovie(source), candidate: dune, details: duneDetails }],
      lib,
    );

    const folder = join(lib, 'Dune (2021)');
    expect(items[0]?.status).toBe('ready');
    expect(companions(items[0]).map((op) => [op.type, op.destination])).toEqual([
      ['write-file', join(folder, 'movie.nfo')],
      ['download', join(folder, 'poster.jpg')],
      ['download', join(folder, 'fanart.jpg')],
    ]);
    // The backdrop is worth its full size, the poster is not.
    expect(companions(items[0]).flatMap((op) => (op.type === 'download' ? [op.url] : []))).toEqual([
      'https://img.test/standard/poster.jpg',
      'https://img.test/original/backdrop.jpg',
    ]);
    // The transfer stays first: the duplicate check and the executor read it there.
    expect(items[0]?.operations[0]?.type).toBe('transfer');
  });

  it('plans nothing beside a file whose details are unknown, or without an image resolver', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const source = await put(join(src, 'Dune.2021.mkv'));
    const input = { parsed: parsedMovie(source), candidate: dune };

    const unknown = await planWith([input], lib);
    expect(companions(unknown.items[0])).toEqual([]);
    expect(unknown.items[0]?.status).toBe('ready');

    const noImages = await createPlan([{ ...input, details: duneDetails }], {
      profile: kodi(),
      destinationRoot: lib,
      mode: 'copy',
    });
    expect(companions(noImages.items[0]).map((op) => op.type)).toEqual(['write-file']);
  });

  it('writes the show files once for a batch of episodes, and a season poster once per season', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const files = await Promise.all(['a', 'b', 'c'].map((name) => put(join(src, `${name}.mkv`))));
    const inputs: PlanInput[] = [
      { parsed: parsedEpisode(files[0] ?? '', 1, [1]), candidate: bear, details: bearDetails },
      { parsed: parsedEpisode(files[1] ?? '', 1, [2]), candidate: bear, details: bearDetails },
      { parsed: parsedEpisode(files[2] ?? '', 2, [1]), candidate: bear, details: bearDetails },
    ];

    const { items } = await planWith(inputs, lib);

    const show = join(lib, 'The Bear (2022)');
    const destinations = items.flatMap((item) => companions(item).map((op) => op.destination));
    expect(destinations.filter((d) => d === join(show, 'tvshow.nfo'))).toHaveLength(1);
    expect(destinations.filter((d) => d === join(show, 'poster.jpg'))).toHaveLength(1);
    expect(destinations.filter((d) => d === join(show, 'fanart.jpg'))).toHaveLength(1);
    expect(destinations).toContain(join(show, 'Season 01', 'season01-poster.jpg'));
    expect(destinations).toContain(join(show, 'Season 02', 'season02-poster.jpg'));
    expect(destinations.filter((d) => d.endsWith('season01-poster.jpg'))).toHaveLength(1);
    // Each episode has its own NFO, named after its video.
    expect(destinations.filter((d) => d.endsWith('.nfo') && !d.endsWith('tvshow.nfo'))).toEqual([
      join(show, 'Season 01', 'The Bear - s01e01.nfo'),
      join(show, 'Season 01', 'The Bear - s01e02.nfo'),
      join(show, 'Season 02', 'The Bear - s02e01.nfo'),
    ]);
    // The first episode carries the show files, the others only their own.
    expect(companions(items[1]).map((op) => op.destination)).toEqual([
      join(show, 'Season 01', 'The Bear - s01e02.nfo'),
    ]);
  });

  it('puts every episode of a double file in its NFO', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const source = await put(join(src, 'a.mkv'));

    const { items } = await planWith(
      [{ parsed: parsedEpisode(source, 1, [1, 2]), candidate: bear, details: bearDetails }],
      lib,
    );

    const nfo = companions(items[0]).find(
      (op) => op.type === 'write-file' && op.destination.endsWith('e02.nfo'),
    );
    expect(nfo?.type === 'write-file' && nfo.content.match(/<episodedetails>/g)).toHaveLength(2);
  });

  it('lets an NFO the user already had win over the generated one', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const source = await put(join(src, 'Dune.2021.mkv'));
    await put(join(src, 'Dune.2021.nfo'));
    const profile = {
      ...kodi(),
      nfo: { format: 'kodi' as const, movie: '{file}.nfo', episode: '{file}.nfo' },
    };

    const { items } = await planWith(
      [{ parsed: parsedMovie(source), candidate: dune, details: duneDetails }],
      lib,
      profile,
    );

    const nfos = (items[0]?.operations ?? []).filter((op) => op.destination.endsWith('.nfo'));
    expect(nfos.map((op) => op.type)).toEqual(['transfer']);
  });

  it('keeps a movie written flat from sharing a fixed file name', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const source = await put(join(src, 'Dune.2021.mkv'));
    const flat = (nfoName: string) =>
      parseProfile(`
id: flat
name: Flat
episodeRangeSeparator: '-e'
templates:
  movieFolder: ''
  movieFile: '{title} ({year})'
  seriesFolder: '{title}'
  seasonFolder: 'S{season:02}'
  episodeFile: '{title}'
nfo: { format: kodi, movie: '${nfoName}', episode: '{file}.nfo' }
artwork:
  - { kind: poster, name: poster.jpg }
filesystem: { forbidden: posix, replacement: '', maxSegmentBytes: 255 }
`);
    const input = { parsed: parsedMovie(source), candidate: dune, details: duneDetails };

    expect(companions((await planWith([input], lib, flat('movie.nfo'))).items[0])).toEqual([]);
    expect(
      companions((await planWith([input], lib, flat('{file}.nfo'))).items[0]).map(
        (op) => op.destination,
      ),
    ).toEqual([join(lib, 'Dune (2021).nfo')]);
  });

  it('plans nothing beside an item that is held back', async () => {
    const [src, lib] = [await makeDir(), await makeDir()];
    const source = await put(join(src, 'Dune.2021.mkv'));
    await put(join(lib, 'Dune (2021)', 'Dune (2021).mkv'));

    const { items } = await planWith(
      [{ parsed: parsedMovie(source), candidate: dune, details: duneDetails }],
      lib,
    );

    expect(items[0]?.status).toBe('conflict');
    expect(items[0]?.operations).toEqual([]);
  });
});

describe('createPlan: an organized library that lacks its NFO and images', () => {
  const planIn = (inputs: PlanInput[], lib: string) =>
    createPlan(inputs, {
      profile: kodi(),
      destinationRoot: lib,
      mode: 'move',
      imageUrl,
      newId: counter(),
    });

  const organizedDune = async (lib: string) => {
    const source = await put(join(lib, 'Dune (2021)', 'Dune (2021).mkv'));
    return { parsed: parsedMovie(source), candidate: dune, details: duneDetails };
  };

  it('plans only the missing files, with no transfer', async () => {
    const lib = await makeDir();
    const input = await organizedDune(lib);
    await put(join(lib, 'Dune (2021)', 'poster.jpg'));

    const { items } = await planIn([input], lib);

    expect(items[0]?.status).toBe('ready');
    // What is already there is left out, not reported as skipped on every rescan.
    expect(items[0]?.operations.map((op) => [op.type, op.destination])).toEqual([
      ['write-file', join(lib, 'Dune (2021)', 'movie.nfo')],
      ['download', join(lib, 'Dune (2021)', 'fanart.jpg')],
    ]);
  });

  it('stays in place once nothing is missing', async () => {
    const lib = await makeDir();
    const input = await organizedDune(lib);
    await Promise.all(
      ['movie.nfo', 'poster.jpg', 'fanart.jpg'].map((name) => put(join(lib, 'Dune (2021)', name))),
    );

    const { items } = await planIn([input], lib);

    expect(items[0]?.status).toBe('in-place');
    expect(items[0]?.operations).toEqual([]);
  });

  it('stays in place when nothing is known about the work', async () => {
    const lib = await makeDir();
    const { parsed, candidate } = await organizedDune(lib);
    const input = { parsed, candidate };

    expect((await planIn([input], lib)).items[0]?.status).toBe('in-place');
  });

  it('is not mistaken for a duplicate when episodes of a show all ask for the show files', async () => {
    const lib = await makeDir();
    const show = join(lib, 'The Bear (2022)');
    const files = await Promise.all(
      [1, 2].map((n) => put(join(show, 'Season 01', `The Bear - s01e0${n}.mkv`))),
    );
    // The first episode already has its NFO; the show files are missing for both.
    await put(join(show, 'Season 01', 'The Bear - s01e01.nfo'));
    await Promise.all(
      ['poster.jpg', 'fanart.jpg', 'season01-poster.jpg'].map((name) =>
        put(join(show, name === 'season01-poster.jpg' ? 'Season 01' : '', name)),
      ),
    );

    const { items } = await planIn(
      files.map((file, index) => ({
        parsed: parsedEpisode(file, 1, [index + 1]),
        candidate: bear,
        details: bearDetails,
      })),
      lib,
    );

    expect(items.map((item) => item.status)).toEqual(['ready', 'ready']);
    expect(items[0]?.operations.map((op) => op.destination)).toEqual([join(show, 'tvshow.nfo')]);
    expect(items[1]?.operations.map((op) => op.destination)).toEqual([
      join(show, 'Season 01', 'The Bear - s01e02.nfo'),
    ]);
  });

  it('leaves in place an episode whose only missing file was claimed by an earlier one', async () => {
    const lib = await makeDir();
    const show = join(lib, 'The Bear (2022)');
    const files = await Promise.all(
      [1, 2].map((n) => put(join(show, 'Season 01', `The Bear - s01e0${n}.mkv`))),
    );
    await Promise.all([1, 2].map((n) => put(join(show, 'Season 01', `The Bear - s01e0${n}.nfo`))));
    await Promise.all(['poster.jpg', 'fanart.jpg'].map((name) => put(join(show, name))));
    await put(join(show, 'Season 01', 'poster.jpg'));
    await put(join(show, 'Season 01', 'season01-poster.jpg'));

    const { items } = await planIn(
      files.map((file, index) => ({
        parsed: parsedEpisode(file, 1, [index + 1]),
        candidate: bear,
        details: bearDetails,
      })),
      lib,
    );

    expect(items.map((item) => item.status)).toEqual(['ready', 'in-place']);
    expect(items[1]?.operations).toEqual([]);
  });

  it('runs and undoes with the video untouched', async () => {
    const lib = await makeDir();
    const input = await organizedDune(lib);
    const { items, ...rest } = await planIn([input], lib);
    const journal = new MemoryJournal();

    const batch = await executePlan(
      { ...rest, items },
      {
        journal,
        newId: counter('x'),
        fetchImage: () => Promise.resolve(new Uint8Array([1, 2, 3])),
      },
    );

    const folder = join(lib, 'Dune (2021)');
    expect(batch.items[0]?.results.map((result) => result.status)).toEqual([
      'done',
      'done',
      'done',
    ]);
    expect((await readdir(folder)).sort()).toEqual([
      'Dune (2021).mkv',
      'fanart.jpg',
      'movie.nfo',
      'poster.jpg',
    ]);

    await undoLastBatch(journal);
    expect(await readdir(folder)).toEqual(['Dune (2021).mkv']);
  });
});
