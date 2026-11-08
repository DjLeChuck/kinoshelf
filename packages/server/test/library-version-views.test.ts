import { join } from 'node:path';
import type { MetadataProvider, SeriesDetails } from '@kinoshelf/core';
import { afterEach, describe, expect, it } from 'vitest';
import { itemId } from '../src/library-items.js';
import { cleanup, fakeProvider, harness, makeDir, put } from './harness.js';

afterEach(cleanup);

interface Coverage {
  resolution: string | null;
  covered: number;
  total: number;
}

/** What the lists say of a work held in several versions. */
describe('a movie held in two versions', () => {
  const FOLDER = 'Dune (2021)';

  async function twoVersions(withNfo: boolean) {
    const root = await makeDir();
    const hd = await put(join(root, FOLDER, `${FOLDER} - 1080p.mkv`), 'hd');
    const uhd = await put(join(root, FOLDER, `${FOLDER} - 2160p.mkv`), 'the bigger one');
    if (withNfo) {
      await put(join(root, FOLDER, 'movie.nfo'), '<movie/>');
    }
    const h = await harness({
      config: {
        libraries: [
          {
            id: 'films',
            name: 'Films',
            source: root,
            type: 'movie',
            naming: 'no-id',
            metadata: 'nfo',
          },
        ],
      },
    });
    await h.request('POST', '/api/libraries/films/scan');
    await h.app.jobs.idle();
    return { h, root, hd, uhd };
  }

  interface Page {
    total: number;
    counts: Record<string, number>;
    items: { versions: { id: string; resolution: string | null; nfo: boolean | null }[] }[];
  }
  const list = async (h: Awaited<ReturnType<typeof twoVersions>>['h'], query = '') =>
    (await h.request('GET', `/api/libraries/films/items${query}`)).json<Page>();

  it('is one entry, however many files, in the list and in every count', async () => {
    const { h } = await twoVersions(true);
    const page = await list(h);
    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.versions).toHaveLength(2);
    expect(page.counts).toMatchObject({ all: 1, 'multi-version': 1, 'missing-nfo': 0 });
    expect((await list(h, '?state=multi-version')).total).toBe(1);
  });

  it('shares one movie.nfo between its versions: there or not, for both', async () => {
    const { h } = await twoVersions(false);
    const page = await list(h);
    expect(page.items[0]?.versions.map(({ nfo }) => nfo)).toEqual([false, false]);
    // Counted as one movie lacking its NFO, not as two files.
    expect(page.counts['missing-nfo']).toBe(1);
    expect((await list(h, '?state=missing-nfo')).total).toBe(1);
  });

  it('names its one expected NFO on the page of an item, whatever the version asked', async () => {
    const { h, root, hd, uhd } = await twoVersions(true);
    for (const file of [hd, uhd]) {
      const detail = (await h.request('GET', `/api/libraries/films/items/${itemId(file)}`)).json<{
        versions: { resolution: string | null }[];
        nfoFiles: { path: string; present: boolean }[];
      }>();
      expect(detail.versions.map(({ resolution }) => resolution)).toEqual(['1080p', '2160p']);
      expect(detail.nfoFiles).toEqual([{ path: join(root, FOLDER, 'movie.nfo'), present: true }]);
    }
  });

  it('is not multi-version with one file', async () => {
    const root = await makeDir();
    await put(join(root, FOLDER, `${FOLDER}.mkv`));
    const h = await harness({
      config: {
        libraries: [{ id: 'films', name: 'Films', source: root, type: 'movie', naming: 'no-id' }],
      },
    });
    await h.request('POST', '/api/libraries/films/scan');
    await h.app.jobs.idle();
    expect((await list(h)).counts).toMatchObject({ all: 1, 'multi-version': 0 });
  });
});

const SHOW = { provider: 'tmdb', id: 93740 };
const DETAILS: SeriesDetails = {
  kind: 'series',
  id: SHOW,
  title: 'Foundation',
  originalTitle: 'Foundation',
  genres: [],
  tags: [],
  studios: [],
  countries: [],
  cast: [],
  seasons: [{ season: 1 }],
};
const provider = (): MetadataProvider => ({
  ...fakeProvider,
  searchSeries: ({ title }) =>
    Promise.resolve(
      title.toLowerCase().startsWith('foundation')
        ? [
            {
              kind: 'series',
              id: SHOW,
              title: 'Foundation',
              originalTitle: 'Foundation',
              alternativeTitles: [],
              year: 2021,
            },
          ]
        : [],
    ),
  getSeason: (_id, season) =>
    Promise.resolve({
      season,
      episodes: [1, 2, 3].map((episode) => ({
        season,
        episode,
        title: `Episode ${String(episode)}`,
        airDate: '2021-09-24',
      })),
    }),
  getSeriesDetails: () => Promise.resolve(DETAILS),
});

interface ShowRow {
  tmdbId: number;
  episodes: number;
  versions: Coverage[];
  episodesLackingNfo: number;
}
interface ShowDetail {
  seasons: {
    season: number;
    versions: Coverage[];
    nfo: { expected: number; present: number };
    episodes: {
      episode: number;
      state: string;
      versions: { path: string; resolution: string | null }[];
      nfo: { expected: number; present: number };
    }[];
  }[];
}

/** Three episodes in 1080p, two of them also in 2160p: the third lacks its 4K. */
async function show(episodes: [number, string][], metadata: 'none' | 'nfo' = 'nfo') {
  const root = await makeDir();
  for (const [number, size] of episodes) {
    await put(join(root, `Foundation.S01E0${String(number)}.${size}.WEB-DL-GRP.mkv`), size);
  }
  const h = await harness({
    config: {
      libraries: [
        {
          id: 'shows',
          name: 'Shows',
          source: root,
          type: 'series',
          naming: 'no-id',
          metadata,
        },
      ],
    },
    createProvider: provider,
  });
  await h.request('POST', '/api/libraries/shows/scan');
  await h.app.jobs.idle();
  return h;
}
type Harness = Awaited<ReturnType<typeof show>>;
const shows = async (h: Harness, query = '') =>
  (await h.request('GET', `/api/libraries/shows/shows${query}`)).json<{
    total: number;
    items: ShowRow[];
  }>();
const counts = async (h: Harness) =>
  (await h.request('GET', '/api/libraries/shows/items')).json<{ counts: Record<string, number> }>()
    .counts;

const FULL: [number, string][] = [
  [1, '1080p'],
  [2, '1080p'],
  [3, '1080p'],
  [1, '2160p'],
  [2, '2160p'],
];

describe('a series held in two versions', () => {
  it('counts the distinct episodes, and each version against them', async () => {
    const h = await show(FULL);
    const [row] = (await shows(h)).items;
    expect(row).toMatchObject({ episodes: 3 });
    expect(row?.versions).toEqual([
      { resolution: '2160p', covered: 2, total: 3 },
      { resolution: '1080p', covered: 3, total: 3 },
    ]);
  });

  it('lists an episode once, with a version per file and the NFO each wants', async () => {
    const h = await show(FULL);
    const detail = (await h.request('GET', '/api/libraries/shows/shows/93740')).json<ShowDetail>();
    const [season] = detail.seasons;
    expect(season?.episodes.map((e) => [e.episode, e.state])).toEqual([
      [1, 'present'],
      [2, 'present'],
      [3, 'present'],
    ]);
    expect(season?.episodes.map((e) => e.versions.map((v) => v.resolution))).toEqual([
      ['1080p', '2160p'],
      ['1080p', '2160p'],
      ['1080p'],
    ]);
    // One NFO per version: nothing is written yet.
    expect(season?.episodes.map((e) => e.nfo)).toEqual([
      { expected: 2, present: 0 },
      { expected: 2, present: 0 },
      { expected: 1, present: 0 },
    ]);
    expect(season?.nfo).toEqual({ expected: 5, present: 0 });
    // The season reads the coverage the list gives, version by version.
    expect(season?.versions).toEqual([
      { resolution: '2160p', covered: 2, total: 3 },
      { resolution: '1080p', covered: 3, total: 3 },
    ]);
  });

  it('lists a show short of one episode in a version under the filters', async () => {
    const h = await show(FULL);
    expect(await counts(h)).toMatchObject({ 'multi-version': 1, 'incomplete-versions': 1 });
    expect((await shows(h, '?state=incomplete-versions')).items.map((s) => s.tmdbId)).toEqual([
      93740,
    ]);
    expect((await shows(h, '?state=multi-version')).total).toBe(1);
  });

  it('is not incomplete once every version holds every episode', async () => {
    const h = await show([
      [1, '1080p'],
      [2, '1080p'],
      [1, '2160p'],
      [2, '2160p'],
    ]);
    expect(await counts(h)).toMatchObject({ 'multi-version': 1, 'incomplete-versions': 0 });
    expect((await shows(h, '?state=incomplete-versions')).total).toBe(0);
  });

  it('is neither with a single version', async () => {
    const h = await show([
      [1, '1080p'],
      [2, '1080p'],
    ]);
    expect(await counts(h)).toMatchObject({ 'multi-version': 0, 'incomplete-versions': 0 });
    const [row] = (await shows(h)).items;
    expect(row).toMatchObject({ episodes: 2 });
    expect(row?.versions).toEqual([{ resolution: '1080p', covered: 2, total: 2 }]);
  });

  it('counts the episodes with a version lacking its NFO, an episode once', async () => {
    const h = await show(FULL);
    // All five files lack theirs, in three episodes.
    expect((await shows(h)).items[0]?.episodesLackingNfo).toBe(3);
  });

  it('expects no NFO when the profile writes none', async () => {
    const h = await show(FULL, 'none');
    const detail = (await h.request('GET', '/api/libraries/shows/shows/93740')).json<ShowDetail>();
    expect(detail.seasons[0]?.nfo).toEqual({ expected: 0, present: 0 });
    expect((await shows(h)).items[0]?.episodesLackingNfo).toBe(0);
  });
});
