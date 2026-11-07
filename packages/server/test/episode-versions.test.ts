import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config, MetadataProvider, SeriesDetails } from '@kinoshelf/core';
import { afterEach, describe, expect, it } from 'vitest';
import { itemId } from '../src/library-items.js';
import { cleanup, fakeProvider, harness, makeDir, put } from './harness.js';

afterEach(cleanup);

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
      episodes: [1, 2].map((episode) => ({
        season,
        episode,
        title: `Episode ${String(episode)}`,
        airDate: '2021-09-24',
      })),
    }),
  getSeriesDetails: () => Promise.resolve(DETAILS),
});

const FULL = 'Foundation.S01E01.MULTi.VFi.1080p.10Bits.WEBRip.AC3.5.1.H265-TARDiS.mkv';
const UHD = "Foundation - S01E01 - La paix de l'empereur.mkv";

/** A series library that holds one episode twice, as a 1080p release and as a 4K nobody labelled. */
async function twoQualities(extra: Partial<Config> = {}) {
  const root = await makeDir();
  const hd = await put(join(root, 'Foundation (2021)', 'S01', FULL), 'hd');
  const uhd = await put(join(root, 'Foundation (2021)', 'Season 1', UHD), 'the 4K one, bigger');
  const h = await harness({
    config: {
      libraries: [
        { id: 'films', name: 'Films', source: await makeDir(), type: 'movie' },
        { id: 'shows', name: 'Shows', source: root, type: 'series', profile: 'jellyfin' },
      ],
      ...extra,
    },
    createProvider: provider,
    // What ffprobe would say of the 4K one; of the other nothing is asked.
    sizeReader: (path) => Promise.resolve(path.endsWith(UHD) ? '2160p' : undefined),
  });
  await h.request('POST', '/api/libraries/shows/scan');
  await h.app.jobs.idle();
  const season = join(root, 'Foundation (2021) {tmdb-93740}', 'Season 01');
  return { h, root, hd, uhd, season };
}

type Two = Awaited<ReturnType<typeof twoQualities>>;
const videos = async (folder: string): Promise<string[]> =>
  (await readdir(folder)).filter((name) => name.endsWith('.mkv')).sort();
const rename = async ({ h }: Two, items: string[], body: object = {}) => {
  const run = await h.request('POST', '/api/libraries/shows/execute', { items, ...body });
  await h.app.jobs.idle();
  return run;
};

describe('two qualities of one episode in a library', () => {
  it('puts both side by side, reading the size of the one whose name says none', async () => {
    const two = await twoQualities();

    const run = await rename(two, [itemId(two.hd), itemId(two.uhd)]);

    expect(run.statusCode).toBe(202);
    expect(await videos(two.season)).toEqual([
      'Foundation (2021) - s01e01 - 1080p.mkv',
      'Foundation (2021) - s01e01 - 2160p.mkv',
    ]);
  });

  it('leaves the one without a size under the bare name when detection is off', async () => {
    const two = await twoQualities({ detectPictureSize: false });

    await rename(two, [itemId(two.hd), itemId(two.uhd)]);

    expect(await videos(two.season)).toEqual([
      'Foundation (2021) - s01e01 - 1080p.mkv',
      'Foundation (2021) - s01e01.mkv',
    ]);
  });
});

describe('two releases of one episode, sent as two jobs', () => {
  it('reads the size of the second one, planned before the first had moved', async () => {
    const { h, season } = await twoQualities();
    const jobs: string[] = [];
    // Outside the library: what two downloads of the same episode would be.
    for (const [folder, name] of [
      ['a', 'Foundation.S01E01.1080p.WEB-DL-GRP.mkv'],
      ['b', UHD],
    ] as const) {
      const source = await makeDir();
      await put(join(source, folder, name), `${name} as it was released`);
      const created = await h.request('POST', '/api/jobs', { path: source, apply: false });
      jobs.push(created.json<{ id: string }>().id);
    }
    await h.app.jobs.idle();

    for (const jobId of jobs) {
      const run = await h.request('POST', `/api/plans/${jobId}/execute`);
      expect(run.statusCode).toBe(202);
      await h.app.jobs.idle();
    }

    expect(await videos(season)).toEqual([
      'Foundation (2021) - s01e01 - 1080p.mkv',
      'Foundation (2021) - s01e01 - 2160p.mkv',
    ]);
  });
});

describe('naming the version of an episode by hand', () => {
  it('adds the size the owner chooses to an episode already in place', async () => {
    const two = await twoQualities({ detectPictureSize: false });
    await rename(two, [itemId(two.hd), itemId(two.uhd)]);
    await h2(two);

    const bare = join(two.season, 'Foundation (2021) - s01e01.mkv');
    const preview = await two.h.request('POST', '/api/libraries/shows/execute', {
      items: [itemId(bare)],
      version: true,
      screenSize: '2160p',
      dryRun: true,
    });

    expect(preview.statusCode).toBe(200);
    expect(
      preview
        .json<{ items: { results: { role: string | null; destination: string }[] }[] }>()
        .items.flatMap((i) => i.results.filter((r) => r.role === 'main'))
        .map((r) => r.destination),
    ).toEqual([join(two.season, 'Foundation (2021) - s01e01 - 2160p.mkv')]);
  });
});

/** Scans the library again so its rows follow what the renames did. */
async function h2({ h }: Two): Promise<void> {
  await h.request('POST', '/api/libraries/shows/scan');
  await h.app.jobs.idle();
}
