import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '@kinoshelf/core';
import type { MetadataProvider, SeasonInfo, SeriesDetails } from '@kinoshelf/core';
import { afterEach, describe, expect, it } from 'vitest';
import { compare, signatureOf } from '../src/completeness.js';
import { LibraryItemStore, type LibraryItem } from '../src/library-items.js';
import { cleanup, fakeProvider, harness, makeDir, put } from './harness.js';

afterEach(cleanup);

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

const SHOW = { provider: 'tmdb', id: 95396 };

const episode = (season: number, number: number, airDate?: string) => ({
  season,
  episode: number,
  title: `Episode ${String(number)}`,
  ...(airDate !== undefined && { airDate }),
});

/** Season 1: three aired episodes. Season 2: one aired, one next century, one with no date. */
const SEASONS: SeasonInfo[] = [
  {
    season: 0,
    episodes: [episode(0, 1, '2021-12-01'), episode(0, 2, '2022-01-01')],
  },
  {
    season: 1,
    episodes: [
      episode(1, 1, '2022-02-18'),
      episode(1, 2, '2022-02-18'),
      episode(1, 3, '2022-02-25'),
    ],
  },
  {
    season: 2,
    episodes: [episode(2, 1, '2023-01-01'), episode(2, 2, '2999-01-01'), episode(2, 3)],
  },
];

const DETAILS: SeriesDetails = {
  kind: 'series',
  id: SHOW,
  title: 'Severance',
  originalTitle: 'Severance',
  overview: 'Work and life, split.',
  genres: ['Drama'],
  tags: [],
  studios: [],
  countries: [],
  cast: [],
  firstAirDate: '2022-02-18',
  status: 'Returning Series',
  seasons: [{ season: 0 }, { season: 1, name: 'Season 1' }, { season: 2 }],
};

const provider = (options: { down?: boolean } = {}): MetadataProvider => ({
  ...fakeProvider,
  searchSeries: ({ title }) =>
    Promise.resolve(
      title.toLowerCase().startsWith('severance')
        ? [
            {
              kind: 'series',
              id: SHOW,
              title: 'Severance',
              originalTitle: 'Severance',
              alternativeTitles: [],
              year: 2022,
            },
          ]
        : [],
    ),
  getSeason: (_id, season) =>
    Promise.resolve(SEASONS.find((candidate) => candidate.season === season) ?? null),
  getSeriesDetails: () =>
    options.down ? Promise.reject(new Error('tmdb is down')) : Promise.resolve(DETAILS),
});

interface Shows {
  total: number;
  items: {
    tmdbId: number;
    title: string;
    seasons: number;
    episodes: number;
    missing: number | null;
  }[];
}

interface Show {
  determined: boolean;
  missing: number | null;
  seasons: {
    season: number;
    missing: number;
    episodes: { episode: number; state: string; versions: { path: string }[] }[];
  }[];
}

/** A series library holding S01E01, a S01E02E03 file, S02E01, a special and a file nobody knows. */
async function scanned(options: { down?: boolean } = {}) {
  const root = await makeDir();
  const files = {
    one: await put(join(root, 'Severance.S01E01.1080p.mkv')),
    double: await put(join(root, 'Severance.S01E02E03.1080p.mkv')),
    second: await put(join(root, 'Severance.S02E01.1080p.mkv')),
    special: await put(join(root, 'Severance.S00E01.1080p.mkv')),
    stranger: await put(join(root, 'Mystery.Home.Video.S01E01.mkv')),
  };
  const h = await harness({
    config: {
      libraries: [
        { id: 'films', name: 'Films', source: await makeDir(), type: 'movie' },
        { id: 'shows', name: 'Shows', source: root, type: 'series' },
      ],
    },
    createProvider: () => provider(options),
  });
  await h.request('POST', '/api/libraries/shows/scan');
  await h.app.jobs.idle();
  await h.app.completeness.idle();
  return { h, files, store: new LibraryItemStore(h.database) };
}

describe('the snapshot of a series library', () => {
  it('keeps the season and the episodes of each file', async () => {
    const { store, files } = await scanned();
    const rows = new Map(store.all('shows').map((item) => [item.path, item]));
    expect(rows.get(files.one)).toMatchObject({
      kind: 'series',
      tmdbId: 95396,
      season: 1,
      episode: 1,
      episodeEnd: null,
    });
    // One row per file: the range stays whole.
    expect(rows.get(files.double)).toMatchObject({ season: 1, episode: 2, episodeEnd: 3 });
    expect(rows.get(files.special)).toMatchObject({ season: 0, episode: 1 });
  });

  it('writes no season or episode for a movie', async () => {
    const { store } = await scanned();
    expect(store.all('films')).toEqual([]);
  });

  it('exposes them in the list, and counts the NFO of an episode only', async () => {
    const { h, files } = await scanned();
    const list = await h.request('GET', '/api/libraries/shows/items');
    const items = list.json<{
      items: {
        path: string;
        season: number | null;
        episode: number | null;
        episodeEnd: number | null;
      }[];
    }>().items;
    expect(items.find((item) => item.path === files.double)).toMatchObject({
      season: 1,
      episode: 2,
      episodeEnd: 3,
    });
  });
});

describe('the shows of a series library', () => {
  it('counts shows in the tabs, and keeps the files nobody identified in files', async () => {
    const { h } = await scanned();
    const body = (await h.request('GET', '/api/libraries/shows/items')).json<{
      counts: Record<string, number>;
    }>();
    // One show (five episodes) and one stranger: the show is counted once in each tab it is in.
    expect(body.counts.all).toBe(1);
    expect(body.counts.rename).toBe(1);
    // A video still to rename has no NFO "missing": all of its files are still to come.
    expect(body.counts['missing-nfo']).toBe(0);
    expect((body.counts.review ?? 0) + (body.counts.unrecognized ?? 0)).toBe(1);
    const state = async (value: string) =>
      (await h.request('GET', `/api/libraries/shows/shows?state=${value}`)).json<Shows>().total;
    // What the show's checkbox runs: its four videos are all still to rename.
    const shows = (await h.request('GET', '/api/libraries/shows/shows')).json<Shows>();
    expect(shows.items[0]).toMatchObject({ rename: 4, refresh: 0 });
    expect(await state('rename')).toBe(body.counts.rename);
    expect(await state('missing-nfo')).toBe(body.counts['missing-nfo']);
    expect(await state('missing-artwork')).toBe(body.counts['missing-artwork']);
  });

  it('lists one row per work, with its seasons and episodes, and leaves the unknown out', async () => {
    const { h } = await scanned();
    const shows = (await h.request('GET', '/api/libraries/shows/shows')).json<Shows>();
    expect(shows.total).toBe(1);
    // Files: S01E01, S01E02-03 (two episodes), S02E01, a special: 5 episodes in 3 seasons.
    expect(shows.items[0]).toMatchObject({
      tmdbId: 95396,
      title: 'Severance',
      seasons: 3,
      episodes: 5,
    });
  });

  it('counts the missing episodes in the background, once the jobs are done', async () => {
    const { h } = await scanned();
    // S01 is whole, S02 lacks nothing aired but one with no date and one in 2999: none missing.
    const shows = (await h.request('GET', '/api/libraries/shows/shows')).json<Shows>();
    expect(shows.items[0]?.missing).toBe(0);
  });

  it('refuses a movie library and an arrival folder', async () => {
    const { h } = await scanned();
    const movies = await h.request('GET', '/api/libraries/films/shows');
    expect(movies.statusCode).toBe(409);
    expect(movies.json()).toEqual({ error: { code: 'library.not-series' } });
  });

  it('leaves the count to the page when the provider fails in the background', async () => {
    const { h } = await scanned({ down: true });
    const shows = (await h.request('GET', '/api/libraries/shows/shows')).json<Shows>();
    expect(shows.items[0]?.missing).toBeNull();
    const counts = (await h.request('GET', '/api/libraries/shows/items')).json<{
      counts: Record<string, number>;
    }>().counts;
    expect(counts['missing-episodes']).toBe(0);
  });
});

describe('the page of a show', () => {
  it('lists the episodes the library lacks, and never counts the unaired or the specials', async () => {
    const { h, files } = await scanned();
    // Drop S01E01: it is aired, and nothing holds it any more.
    const { rm } = await import('node:fs/promises');
    await rm(files.one);
    await h.request('POST', '/api/libraries/shows/scan');
    await h.app.jobs.idle();
    await h.app.completeness.idle();

    const show = (await h.request('GET', '/api/libraries/shows/shows/95396')).json<Show>();
    expect(show.determined).toBe(true);
    expect(show.missing).toBe(1);
    const [specials, first, second] = show.seasons;
    expect(specials).toMatchObject({ season: 0, missing: 0 });
    // Only the special the library holds is listed.
    expect(specials?.episodes.map((e) => e.episode)).toEqual([1]);
    expect(first?.missing).toBe(1);
    expect(first?.episodes.map((e) => [e.episode, e.state])).toEqual([
      [1, 'missing'],
      [2, 'present'],
      [3, 'present'],
    ]);
    // The two episodes of the double file share it.
    expect(first?.episodes[1]?.versions.map((v) => v.path)).toEqual([files.double]);
    expect(first?.episodes[2]?.versions.map((v) => v.path)).toEqual([files.double]);
    expect(second?.episodes.map((e) => [e.episode, e.state])).toEqual([
      [1, 'present'],
      [2, 'unaired'],
      [3, 'unaired'],
    ]);

    // The list follows, and the filter finds the show.
    const shows = (await h.request('GET', '/api/libraries/shows/shows?missing=true')).json<Shows>();
    expect(shows.items.map((item) => [item.title, item.missing])).toEqual([['Severance', 1]]);
    const counts = (await h.request('GET', '/api/libraries/shows/items')).json<{
      counts: Record<string, number>;
    }>().counts;
    expect(counts['missing-episodes']).toBe(1);
  });

  it('counts again when a file comes or goes, and leaves an unchanged show alone', async () => {
    const { h, files } = await scanned();
    const { rm } = await import('node:fs/promises');
    await rm(files.double);
    await h.request('POST', '/api/libraries/shows/scan');
    await h.app.jobs.idle();
    await h.app.completeness.idle();
    const shows = (await h.request('GET', '/api/libraries/shows/shows')).json<Shows>();
    // E02 and E03 of season 1 are aired and gone.
    expect(shows.items[0]?.missing).toBe(2);
  });

  it('still lists the files when the provider cannot be asked', async () => {
    const { h } = await scanned({ down: true });
    const show = (await h.request('GET', '/api/libraries/shows/shows/95396')).json<Show>();
    expect(show.determined).toBe(false);
    expect(show.missing).toBeNull();
    expect(show.seasons.map((s) => s.season)).toEqual([0, 1, 2]);
    expect(show.seasons.every((s) => s.missing === 0)).toBe(true);
  });

  it('is 404 for a show the library does not hold', async () => {
    const { h } = await scanned();
    expect((await h.request('GET', '/api/libraries/shows/shows/1')).statusCode).toBe(404);
  });
});

describe('comparing the files with the provider', () => {
  const row = (season: number, episode: number, episodeEnd: number | null = null): LibraryItem => ({
    libraryId: 'shows',
    path: `/s${String(season)}e${String(episode)}.mkv`,
    kind: 'series',
    tmdbId: 1,
    title: 'Show',
    year: 2020,
    season,
    episode,
    episodeEnd,
    state: 'ok',
    nfo: null,
    poster: null,
    fanart: null,
    logo: null,
    thumb: null,
    entryId: null,
    scanJobId: null,
    scannedAt: '2026-01-01T00:00:00Z',
    picture: null,
  });

  it('flags an episode a file claims and the provider does not know', () => {
    const [season] = compare(
      [row(1, 9)],
      [{ season: 1, episodes: [episode(1, 1, '2020-01-01')] }],
      [],
      '2026-01-01',
    );
    expect(season?.episodes.map((e) => [e.episode, e.state])).toEqual([
      [1, 'missing'],
      [9, 'extra'],
    ]);
    expect(season?.missing).toBe(1);
  });

  it('lists the versions of an episode as one present episode, never as unknown to the provider', () => {
    const version = { ...row(1, 1), path: '/s1e1 - 2160p.mkv' };
    const [season] = compare(
      [row(1, 1), version],
      [{ season: 1, episodes: [episode(1, 1, '2020-01-01'), episode(1, 2, '2020-01-08')] }],
      [],
      '2026-01-01',
    );
    expect(
      season?.episodes.map((e) => [e.episode, e.state, e.versions.map((v) => v.path)]),
    ).toEqual([
      [1, 'present', ['/s1e1.mkv', '/s1e1 - 2160p.mkv']],
      [2, 'missing', []],
    ]);
    expect(season?.missing).toBe(1);
  });

  it('tells two versions apart by the picture the probe read when their names do not', () => {
    const small = { ...row(1, 1), path: '/a.mkv', picture: '720p' };
    const large = { ...row(1, 1), path: '/b.mkv', picture: '1080p' };
    const [season] = compare(
      [small, large, { ...row(1, 2), path: '/c.mkv', picture: '1080p' }],
      [{ season: 1, episodes: [episode(1, 1, '2020-01-01'), episode(1, 2, '2020-01-08')] }],
      [],
      '2026-01-01',
    );
    expect(season?.versions).toEqual([
      { resolution: '1080p', covered: 2, total: 2 },
      { resolution: '720p', covered: 1, total: 2 },
    ]);
  });

  it('reports no specials season when the library holds none of them', () => {
    const seasons = [
      { season: 0, episodes: [episode(0, 1, '2020-01-01')] },
      { season: 1, episodes: [episode(1, 1, '2020-01-01')] },
    ];
    const without = compare([row(1, 1)], seasons, [], '2026-01-01');
    expect(without.map((s) => s.season)).toEqual([1]);
    const withOne = compare([row(1, 1), row(0, 1)], seasons, [], '2026-01-01');
    expect(withOne.map((s) => s.season)).toEqual([0, 1]);
  });

  it('is the same signature for the same episodes in any order, another when one changes', () => {
    expect(signatureOf([row(1, 1), row(1, 2)])).toBe(signatureOf([row(1, 2), row(1, 1)]));
    expect(signatureOf([row(1, 1), row(1, 2)])).not.toBe(signatureOf([row(1, 1), row(1, 2, 3)]));
  });
});

describe('an episode that arrives', () => {
  it('is validated into the series library chosen', async () => {
    const configDir = await makeDir();
    await put(join(configDir, 'config.yaml'), '');
    const h = await harness({
      configDir,
      config: await loadConfig(configDir),
      createProvider: () => provider(),
    });
    const roots = { films: await makeDir(), shows: await makeDir(), anime: await makeDir() };
    const downloads = await makeDir();
    const create = (body: object): Promise<unknown> => h.request('POST', '/api/libraries', body);
    await create({ name: 'Films', source: roots.films, type: 'movie' });
    await create({ name: 'Shows', source: roots.shows, type: 'series' });
    await create({ name: 'Anime', source: roots.anime, type: 'series' });
    await create({
      name: 'Downloads',
      source: downloads,
      into: { movie: 'films', series: 'shows' },
    });
    const scan = async (): Promise<string> => {
      const response = await h.request('POST', '/api/libraries/downloads/scan');
      await h.app.jobs.idle();
      return response.json<{ id: string }>().id;
    };

    // The name says nothing to TMDB: a person picks the show, and the library.
    await put(join(downloads, 'Mystery.Home.Video.S01E02.mkv'), 'two');
    const jobId = await scan();
    const waiting = (await h.request('GET', '/api/arrivals')).json<{
      items: { id: string; kind: string; destinationOptions: { id: string }[] }[];
    }>().items;
    // An episode can only go to a library of series.
    expect(waiting[0]).toMatchObject({ kind: 'series' });
    expect(waiting[0]?.destinationOptions.map((option) => option.id)).toEqual(['shows', 'anime']);
    const matched = await h.request('POST', `/api/entries/${waiting[0]?.id ?? ''}/match`, {
      kind: 'series',
      id: SHOW,
      title: 'Severance',
      year: 2022,
      libraryId: 'anime',
      remember: false,
    });
    expect(matched.statusCode).toBe(200);
    expect((await h.request('POST', `/api/plans/${jobId}/execute`)).statusCode).toBe(202);
    await h.app.jobs.idle();
    const rows = new LibraryItemStore(h.database).all('anime');
    expect(rows).toMatchObject([{ tmdbId: 95396, season: 1, episode: 2, state: 'ok' }]);
    expect(rows[0]?.path.startsWith(roots.anime)).toBe(true);
  });
});

describe('the files of a show and of its seasons', () => {
  it('are looked for on the disk after a scan, and again when it changes', async () => {
    const root = await makeDir();
    const show = join(root, 'Severance (2022)');
    await put(join(show, 'Season 01', 'Severance (2022) - s01e01.mkv'));
    await put(join(show, 'Season 02', 'Severance (2022) - s02e01.mkv'));
    await put(join(show, 'tvshow.nfo'), '<tvshow/>');
    await put(join(show, 'poster.jpg'), 'image');
    await put(join(show, 'season01-poster.jpg'), 'image');
    const h = await harness({
      config: {
        libraries: [
          { id: 'films', name: 'Films', source: await makeDir(), type: 'movie' },
          {
            id: 'shows',
            name: 'Shows',
            source: root,
            type: 'series',
            naming: 'no-id',
            metadata: 'nfo',
          },
        ],
      },
      createProvider: () => provider(),
    });
    const scan = async (): Promise<void> => {
      await h.request('POST', '/api/libraries/shows/scan');
      await h.app.jobs.idle();
      await h.app.seriesFiles.idle();
    };
    const listed = async () =>
      (await h.request('GET', '/api/libraries/shows/shows')).json<{
        items: {
          nfo: boolean | null;
          poster: boolean | null;
          fanart: boolean | null;
          logo: boolean | null;
        }[];
      }>().items[0];
    const seasonPosters = async () =>
      (await h.request('GET', '/api/libraries/shows/shows/95396'))
        .json<{ seasons: { season: number; poster: boolean | null }[] }>()
        // The specials hold no file here: nothing to say of them.
        .seasons.filter(({ season }) => season > 0)
        .map(({ season, poster }) => [season, poster]);

    const incomplete = async () =>
      (await h.request('GET', '/api/libraries/shows/shows?incomplete=true')).json<{
        total: number;
      }>().total;
    const counted = async () =>
      (await h.request('GET', '/api/libraries/shows/items')).json<{
        counts: Record<string, number>;
      }>().counts['missing-show-files'];

    // Not looked at yet before the first scan ends: nothing is claimed.
    await scan();
    // No fanart, and no poster for the second season: the show is incomplete, counted as one.
    expect(await incomplete()).toBe(1);
    expect(await counted()).toBe(1);
    expect(await listed()).toMatchObject({ nfo: true, poster: true, fanart: false, logo: false });
    // A season's poster is its own file, apart from the show's `poster.jpg`.
    expect(await seasonPosters()).toEqual([
      [1, true],
      [2, false],
    ]);

    // The logo alone keeps the show incomplete.
    await put(join(show, 'background.jpg'), 'image');
    await put(join(show, 'season02-poster.jpg'), 'image');
    await scan();
    expect(await listed()).toMatchObject({ fanart: true, logo: false });
    expect(await incomplete()).toBe(1);

    await put(join(show, 'logo.png'), 'image');
    await scan();
    expect(await listed()).toMatchObject({ logo: true });
    expect(await seasonPosters()).toEqual([
      [1, true],
      [2, true],
    ]);
    expect(await incomplete()).toBe(0);
    expect(await counted()).toBe(0);
  });

  it('are not claimed for a show whose videos are not in place yet', async () => {
    const { h } = await scanned();
    await h.app.seriesFiles.idle();
    const [row] = (await h.request('GET', '/api/libraries/shows/shows')).json<{
      items: {
        nfo: boolean | null;
        poster: boolean | null;
        fanart: boolean | null;
        logo: boolean | null;
      }[];
    }>().items;
    expect(row).toMatchObject({ nfo: null, poster: null, fanart: null, logo: null });
  });
});

describe('refreshing some episodes of a show', () => {
  it('writes the show’s own files even when the episode carrying them is left out', async () => {
    const root = await makeDir();
    const show = join(root, 'Severance (2022)');
    await put(join(show, 'Season 01', 'Severance (2022) - s01e01.mkv'));
    const second = await put(join(show, 'Season 01', 'Severance (2022) - s01e02.mkv'));
    const h = await harness({
      config: {
        libraries: [
          { id: 'films', name: 'Films', source: await makeDir(), type: 'movie' },
          {
            id: 'shows',
            name: 'Shows',
            source: root,
            type: 'series',
            naming: 'no-id',
            metadata: 'nfo',
          },
        ],
      },
      createProvider: () => provider(),
    });
    await h.request('POST', '/api/libraries/shows/scan');
    await h.app.jobs.idle();
    const { items } = (await h.request('GET', '/api/libraries/shows/items')).json<{
      items: { id: string; path: string }[];
    }>();
    const chosen = items.find(({ path }) => path === second)?.id ?? '';

    const run = await h.request('POST', '/api/libraries/shows/execute', { items: [chosen] });
    expect(run.statusCode).toBe(202);
    await h.app.jobs.idle();
    expect(await exists(join(show, 'tvshow.nfo'))).toBe(true);
    expect(await exists(join(show, 'Season 01', 'Severance (2022) - s01e02.nfo'))).toBe(true);
    // The other episode's own NFO is not this selection's.
    expect(await exists(join(show, 'Season 01', 'Severance (2022) - s01e01.nfo'))).toBe(false);
  });
});

describe('a show lacking only files of its own', () => {
  /** Two episodes with their own NFO, the show's files there, season 1's poster known to TMDB. */
  async function lacking() {
    const root = await makeDir();
    const show = join(root, 'Severance (2022)');
    for (const [season, name] of [
      ['01', 's01e01'],
      ['02', 's02e01'],
    ] as const) {
      await put(join(show, `Season ${season}`, `Severance (2022) - ${name}.mkv`));
      await put(
        join(show, `Season ${season}`, `Severance (2022) - ${name}.nfo`),
        '<episodedetails/>',
      );
    }
    await put(join(show, 'tvshow.nfo'), '<tvshow/>');
    await put(join(show, 'poster.jpg'), 'image');
    const withPosters: SeriesDetails = {
      ...DETAILS,
      seasons: [{ season: 1, name: 'Season 1', posterPath: '/s1.jpg' }, { season: 2 }],
    };
    const h = await harness({
      config: {
        libraries: [
          { id: 'films', name: 'Films', source: await makeDir(), type: 'movie' },
          {
            id: 'shows',
            name: 'Shows',
            source: root,
            type: 'series',
            naming: 'no-id',
            metadata: 'nfo',
          },
        ],
      },
      createProvider: () => ({
        ...provider(),
        getSeriesDetails: () => Promise.resolve(withPosters),
      }),
    });
    const scan = async (): Promise<void> => {
      await h.request('POST', '/api/libraries/shows/scan');
      await h.app.jobs.idle();
    };
    const states = async (): Promise<(string | undefined)[][]> =>
      (await h.request('GET', '/api/libraries/shows/items'))
        .json<{ items: { episode: number; season: number; state: string }[] }>()
        .items.map(({ season, episode, state }) => [`s${season}e${episode}`, state]);
    return { h, show, scan, states };
  }

  it('can be refreshed: its first episode carries what is missing', async () => {
    const { h, scan, states, show } = await lacking();
    await scan();
    // Season 1's poster lies with the show's files and belongs to no flag of an episode, yet
    // without a box to tick for it nothing could ever write it.
    expect(await states()).toEqual([
      ['s1e1', 'incomplete'],
      ['s2e1', 'ok'],
    ]);
    const shows = (await h.request('GET', '/api/libraries/shows/shows')).json<{
      items: { refresh: number }[];
    }>();
    expect(shows.items[0]?.refresh).toBe(1);

    // Once the file is there, nothing is left to refresh.
    await put(join(show, 'season01-poster.jpg'), 'image');
    await scan();
    expect(await states()).toEqual([
      ['s1e1', 'ok'],
      ['s2e1', 'ok'],
    ]);
  });
});

describe('the thumbnail of an episode', () => {
  it('is tracked per file, and an episode lacking it is incomplete and under missing-artwork', async () => {
    const root = await makeDir();
    const season = join(root, 'Severance (2022)', 'Season 01');
    const withThumb = await put(join(season, 'Severance (2022) - s01e01.mkv'));
    await put(join(season, 'Severance (2022) - s01e01.nfo'), '<episodedetails/>');
    await put(join(season, 'Severance (2022) - s01e01.jpg'), 'image');
    const without = await put(join(season, 'Severance (2022) - s01e02.mkv'));
    await put(join(season, 'Severance (2022) - s01e02.nfo'), '<episodedetails/>');
    const base = provider();
    const h = await harness({
      config: {
        libraries: [
          { id: 'films', name: 'Films', source: await makeDir(), type: 'movie' },
          {
            id: 'shows',
            name: 'Shows',
            source: root,
            type: 'series',
            naming: 'no-id',
            metadata: 'nfo',
          },
        ],
      },
      createProvider: () => ({
        ...base,
        getSeason: async (id, number) => {
          const found = await base.getSeason(id, number);
          return found && number === 1
            ? {
                ...found,
                episodes: found.episodes.map((info) => ({ ...info, stillPath: '/still.jpg' })),
              }
            : found;
        },
      }),
    });
    await h.request('POST', '/api/libraries/shows/scan');
    await h.app.jobs.idle();

    const page = (await h.request('GET', '/api/libraries/shows/items')).json<{
      library: { writes: { thumb: boolean } };
      items: { path: string; thumb: boolean | null; state: string }[];
    }>();
    expect(page.library.writes.thumb).toBe(true);
    const byPath = new Map(page.items.map((item) => [item.path, item]));
    expect(byPath.get(withThumb)).toMatchObject({ thumb: true });
    expect(byPath.get(without)).toMatchObject({ thumb: false, state: 'incomplete' });

    const missing = (
      await h.request('GET', '/api/libraries/shows/items?state=missing-artwork')
    ).json<{ items: { path: string }[] }>();
    expect(missing.items.map((item) => item.path)).toEqual([without]);
  });
});
