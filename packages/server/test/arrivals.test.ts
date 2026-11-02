import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '@kinoshelf/core';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, harness, makeDir, put, type Harness } from './harness.js';

afterEach(cleanup);

const DUNE = { kind: 'movie', id: { provider: 'tmdb', id: 438631 }, title: 'Dune', year: 2021 };
const DUNE_NAME = (root: string): string =>
  join(root, 'Dune (2021) {tmdb-438631}', 'Dune (2021) {tmdb-438631}.mkv');

interface Arrival {
  id: string;
  jobId: string;
  file: string;
  state: string;
  kind: string | null;
  resolution: string | null;
  sourceId: string | null;
  destination: { libraryId: string | null };
  destinationOptions: { id: string; name: string }[];
  plannedPath: string | null;
}

interface Arrivals {
  total: number;
  sources: { id: string; name: string; path: string }[];
  items: Arrival[];
}

/**
 * Two movie libraries and a series one, and an arrival folder pointing at the first of each. The
 * server reads a real config.yaml: libraries live there.
 */
async function setup() {
  const configDir = await makeDir();
  await put(join(configDir, 'config.yaml'), '');
  const h = await harness({ configDir, config: await loadConfig(configDir) });
  const roots = { films: await makeDir(), uhd: await makeDir(), series: await makeDir() };
  const create = (body: object): Promise<unknown> => h.request('POST', '/api/libraries', body);
  await create({ name: 'Films', source: roots.films, type: 'movie' });
  await create({ name: 'Films 4K', source: roots.uhd, type: 'movie' });
  await create({ name: 'Series', source: roots.series, type: 'series' });
  const downloads = await makeDir();
  await create({
    name: 'Downloads',
    source: downloads,
    into: { movie: 'films', series: 'series' },
  });
  return { h, roots, downloads };
}

async function scanDownloads(h: Harness): Promise<string> {
  const response = await h.request('POST', '/api/libraries/downloads/scan');
  expect(response.statusCode).toBe(202);
  await h.app.jobs.idle();
  return response.json<{ id: string }>().id;
}

const arrivals = async (h: Harness, query = ''): Promise<Arrivals> =>
  (await h.request('GET', `/api/arrivals${query}`)).json<Arrivals>();

describe('GET /api/entries/:id', () => {
  it('shows one file like the arrivals do, wherever it lives', async () => {
    const { h, roots } = await setup();
    await put(join(roots.films, 'Mystery.Home.Video.mkv'));
    expect((await h.request('POST', '/api/libraries/films/scan')).statusCode).toBe(202);
    await h.app.jobs.idle();
    const { items } = (await h.request('GET', '/api/libraries/films/items')).json<{
      items: { entryId: string }[];
    }>();
    const response = await h.request('GET', `/api/entries/${items[0]?.entryId}`);
    expect(response.statusCode).toBe(200);
    expect(response.json<Arrival>()).toMatchObject({ file: 'Mystery.Home.Video.mkv' });
    expect((await h.request('GET', '/api/entries/nope')).statusCode).toBe(404);
  });
});

describe('GET /api/arrivals', () => {
  it('lists what an arrival folder holds that needs a human, with where it would go', async () => {
    const { h, roots, downloads } = await setup();
    await put(join(downloads, 'Mystery.Home.Video.2160p.mkv'));
    await put(join(downloads, 'Dune.2021.mkv'));
    await scanDownloads(h);

    const found = await arrivals(h);
    expect(found.total).toBe(1);
    expect(found.sources).toEqual([{ id: 'downloads', name: 'Downloads', path: downloads }]);
    expect(found.items).toHaveLength(1);
    expect(found.items[0]).toMatchObject({
      file: 'Mystery.Home.Video.2160p.mkv',
      state: 'unrecognized',
      resolution: '2160p',
      sourceId: 'downloads',
      plannedPath: null,
      kind: 'movie',
      destination: { libraryId: 'films' },
    });
    // Only the libraries of its kind are offered.
    expect(found.items[0]?.destinationOptions.map((o) => o.id)).toEqual(['films', 'films-4k']);
    expect((await arrivals(h, '?state=review')).items).toEqual([]);
    expect((await arrivals(h, '?state=unrecognized')).total).toBe(1);
    expect(roots.films).not.toBe(roots.uhd);
  });

  it('offers every library for a file whose kind nobody could tell', async () => {
    const { h, downloads } = await setup();
    // An episode number with no season: neither a film nor an episode Kinoshelf can place.
    await put(join(downloads, '[Group] Some Anime - 05 [1080p].mkv'));
    await scanDownloads(h);

    const [unknown] = (await arrivals(h)).items;
    expect(unknown).toMatchObject({
      kind: null,
      state: 'unrecognized',
      destination: { libraryId: null },
    });
    expect(unknown?.destinationOptions.map((o) => o.id)).toEqual(['films', 'films-4k', 'series']);
  });

  it('leaves out what a library organized in place holds', async () => {
    const { h, roots } = await setup();
    await put(join(roots.films, 'Mystery.Home.Video.mkv'));
    expect((await h.request('POST', '/api/libraries/films/scan')).statusCode).toBe(202);
    await h.app.jobs.idle();
    expect((await arrivals(h)).total).toBe(0);
  });

  it('shows a path sent by hand: it belongs to no folder', async () => {
    const { h } = await setup();
    const source = await makeDir();
    await put(join(source, 'Mystery.Home.Video.mkv'));
    await h.request('POST', '/api/jobs', { path: source });
    await h.app.jobs.idle();
    expect((await arrivals(h)).items[0]).toMatchObject({ sourceId: null });
  });
});

describe('choosing where an arrival goes', () => {
  it('sends the file to the library chosen, previews it, and leaves the default alone', async () => {
    const { h, roots, downloads } = await setup();
    await put(join(downloads, 'Mystery.Home.Video.mkv'), 'dune');
    const jobId = await scanDownloads(h);
    const [mystery] = (await arrivals(h)).items;
    const id = mystery?.id ?? '';

    const preview = await h.request('POST', `/api/entries/${id}/preview`, {
      ...DUNE,
      libraryId: 'films-4k',
    });
    expect(preview.json()).toMatchObject({ destination: DUNE_NAME(roots.uhd) });
    const byDefault = await h.request('POST', `/api/entries/${id}/preview`, DUNE);
    expect(byDefault.json()).toMatchObject({ destination: DUNE_NAME(roots.films) });

    const matched = await h.request('POST', `/api/entries/${id}/match`, {
      ...DUNE,
      libraryId: 'films-4k',
    });
    expect(matched.statusCode).toBe(200);
    expect(matched.json()).toMatchObject({ destination: DUNE_NAME(roots.uhd) });

    const run = await h.request('POST', `/api/plans/${jobId}/execute`);
    expect(run.statusCode).toBe(202);
    await h.app.jobs.idle();
    expect(await readFile(DUNE_NAME(roots.uhd), 'utf8')).toBe('dune');

    // The destination library knows its new video without a scan.
    const items = (await h.request('GET', '/api/libraries/films-4k/items')).json<{
      items: { path: string; title: string; state: string }[];
    }>();
    expect(items.items).toMatchObject([{ path: DUNE_NAME(roots.uhd), title: 'Dune', state: 'ok' }]);
  });

  it('refuses a library that is missing or holds the other kind of work', async () => {
    const { h, downloads } = await setup();
    await put(join(downloads, 'Mystery.Home.Video.mkv'));
    await scanDownloads(h);
    const id = (await arrivals(h)).items[0]?.id ?? '';

    const wrong = await h.request('POST', `/api/entries/${id}/match`, {
      ...DUNE,
      libraryId: 'series',
    });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json()).toEqual({
      error: { code: 'library.wrong-type', params: { name: 'Series' } },
    });
    const missing = await h.request('POST', `/api/entries/${id}/match`, {
      ...DUNE,
      libraryId: 'ghost',
    });
    expect(missing.statusCode).toBe(404);
    // Nothing was recorded.
    expect((await arrivals(h)).total).toBe(1);
  });
});

describe('choosing where a file goes', () => {
  it('sends only that file to the library picked, the next ones keep the default', async () => {
    const { h, roots, downloads } = await setup();
    await put(join(downloads, 'Mystery.Home.Video.mkv'));
    await scanDownloads(h);
    const id = (await arrivals(h)).items[0]?.id ?? '';
    const matched = await h.request('POST', `/api/entries/${id}/match`, {
      ...DUNE,
      libraryId: 'films-4k',
      remember: false,
    });
    expect(matched.statusCode).toBe(200);
    // Nothing is learned about the work: the route is gone with its table.
    expect((await h.request('GET', '/api/work-destinations')).statusCode).toBe(404);

    await put(join(downloads, 'Dune.2021.1080p.mkv'));
    const jobId = await scanDownloads(h);
    const [dune] = (await h.request('GET', `/api/jobs/${jobId}/entries`))
      .json<{ path: string; destination: string }[]>()
      .filter((entry) => entry.path.endsWith('Dune.2021.1080p.mkv'));
    expect(dune?.destination.startsWith(roots.uhd)).toBe(false);
  });
});
