import { link } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPlan,
  KinoshelfError,
  loadBundledProfile,
  parseProfile,
  type PlanInput,
  type PlanItem,
  type Profile,
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

  it('rejects, for now, a profile that writes NFO or artwork', async () => {
    const lib = await makeDir();
    const withNfo = parseProfile(`
id: kodi
name: Kodi
episodeRangeSeparator: '-e'
templates:
  movieFolder: '{title}'
  movieFile: '{title}'
  seriesFolder: '{title}'
  seasonFolder: 'S{season:02}'
  episodeFile: '{title}'
nfo: { format: kodi, movie: movie.nfo, episode: '{file}.nfo' }
filesystem: { forbidden: posix, replacement: '', maxSegmentBytes: 255 }
`);
    await expect(plan([], lib, { profile: withNfo })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof KinoshelfError && error.info.code === 'plan.profile-feature-unsupported',
    );
  });
});
