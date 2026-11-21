import type { ReadableStreamDefaultReader } from 'node:stream/web';
import { link, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '@kinoshelf/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntryStore } from '../src/entries.js';
import { cleanup, harness, jobEntries, makeDir, put, type Harness } from './harness.js';
import { LibraryItemStore } from '../src/library-items.js';
import { ExecutionStore } from '../src/executions.js';

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
  duplicate: {
    kind: string;
    path: string;
    file: string;
    libraryName: string;
    forced: string | null;
  } | null;
  presentEpisodes: { file: string }[];
}

interface Arrivals {
  total: number;
  counts: Record<'ready' | 'review' | 'unrecognized' | 'present', number>;
  sources: { id: string; name: string; path: string }[];
  items: Arrival[];
}

/**
 * Two movie libraries and a series one, and an arrival folder pointing at the first of each. The
 * server reads a real config.yaml: libraries live there.
 */
async function setup() {
  const configDir = await makeDir();
  await put(join(configDir, 'config.yaml'), 'naming: with-id\nmetadata: none\n');
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
    // Dune is matched but the scan only reads: it waits for a go, like the film nobody found.
    expect(found.total).toBe(2);
    expect(found.sources).toEqual([{ id: 'downloads', name: 'Downloads', path: downloads }]);
    expect(found.items.map((item) => [item.file, item.state])).toEqual([
      ['Dune.2021.mkv', 'ready'],
      ['Mystery.Home.Video.2160p.mkv', 'unrecognized'],
    ]);
    expect(found.items[1]).toMatchObject({
      file: 'Mystery.Home.Video.2160p.mkv',
      state: 'unrecognized',
      resolution: '2160p',
      sourceId: 'downloads',
      kind: 'movie',
      destination: { libraryId: 'films' },
    });
    // Only the libraries of its kind are offered.
    expect(found.items[1]?.destinationOptions.map((o) => o.id)).toEqual(['films', 'films-4k']);
    expect((await arrivals(h, '?state=review')).items).toEqual([]);
    expect((await arrivals(h, '?state=ready')).items.map((item) => item.file)).toEqual([
      'Dune.2021.mkv',
    ]);
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

  it('sends an arrival folder only to the kinds it names', async () => {
    const { h } = await setup();
    const films = await makeDir();
    const created = await h.request('POST', '/api/libraries', {
      name: 'Films only',
      source: films,
      into: { movie: 'films' },
    });
    expect(created.statusCode, created.body).toBe(201);
    await put(join(films, 'Mystery.Home.Video.mkv'));
    await put(join(films, 'Mystery.Show.S01E01.mkv'));
    expect((await h.request('POST', '/api/libraries/films-only/scan')).statusCode).toBe(202);
    await h.app.jobs.idle();

    const found = (await arrivals(h)).items;
    const movie = found.find(({ file }) => file === 'Mystery.Home.Video.mkv');
    const episode = found.find(({ file }) => file === 'Mystery.Show.S01E01.mkv');
    expect(movie?.destination).toEqual({ libraryId: 'films' });
    // Not the first series library: this folder was told to send movies only. The libraries of the
    // kind stay offered, so a human can still choose one.
    expect(episode?.destination).toEqual({ libraryId: null });
    expect(episode?.destinationOptions.map((o) => o.id)).toEqual(['series']);
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

    const matched = await h.match(id, {
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

    const wrong = await h.match(id, {
      ...DUNE,
      libraryId: 'series',
    });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json()).toEqual({
      error: { code: 'library.wrong-type', params: { name: 'Series' } },
    });
    const missing = await h.match(id, {
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
    const matched = await h.match(id, {
      ...DUNE,
      libraryId: 'films-4k',
      remember: false,
    });
    expect(matched.statusCode).toBe(200);
    // Nothing is learned about the work: the route is gone with its table.
    expect((await h.request('GET', '/api/work-destinations')).statusCode).toBe(404);

    await put(join(downloads, 'Dune.2021.1080p.mkv'));
    const jobId = await scanDownloads(h);
    const [dune] = jobEntries<{ path: string; destination: string }>(h, jobId).filter((entry) =>
      entry.path.endsWith('Dune.2021.1080p.mkv'),
    );
    expect(dune?.destination.startsWith(roots.uhd)).toBe(false);
  });
});

describe('a release of many files', () => {
  it('reads its group once, not once per file', async () => {
    const h = await harness({});
    h.database
      .prepare(`INSERT INTO jobs (id, path, status, created_at) VALUES ('j', '/d', 'done', 'x')`)
      .run();
    const insert = h.database.prepare(
      `INSERT INTO job_entries (id, job_id, path, classification, parsed, outcome, release, cluster)
       VALUES (?, 'j', ?, 'ambiguous', ?, '{"reason":"ambiguous","candidates":[]}', '/d/Show', 0)`,
    );
    for (let episode = 1; episode <= 60; episode++) {
      const parsed = JSON.stringify({ kind: 'episode', title: 'Show', season: 1, episode });
      insert.run(`e${String(episode)}`, `/d/Show/e${String(episode)}.mkv`, parsed);
    }
    const reads = vi.spyOn(EntryStore.prototype, 'releaseGroup');
    try {
      const answer = await h.request('GET', '/api/arrivals?limit=50');
      expect(answer.json<Arrivals>().items).toHaveLength(60);
      // One read of the release for its 60 files: it was one per file, 60 reads of 60 rows.
      expect(reads).toHaveBeenCalledTimes(1);
    } finally {
      reads.mockRestore();
    }
  });
});

describe('arrivals the destination library already holds', () => {
  /** Dune is in Films under its own name, scanned so the snapshot knows it. */
  async function withDune(contents = 'the same twenty-eight gigabytes') {
    const world = await setup();
    const there = await put(DUNE_NAME(world.roots.films), contents);
    expect((await world.h.request('POST', '/api/libraries/films/scan')).statusCode).toBe(202);
    await world.h.app.jobs.idle();
    return { ...world, there };
  }

  it('puts a hardlink in "present", never in "ready", and counts every state', async () => {
    const { h, there, downloads } = await withDune();
    await link(there, join(downloads, 'Dune.2021.1080p.mkv'));
    await put(join(downloads, 'Mystery.Home.Video.mkv'));
    await scanDownloads(h);

    const found = await arrivals(h);
    expect(found.counts).toEqual({ ready: 0, review: 0, unrecognized: 1, present: 1 });
    const dune = found.items.find(({ file }) => file === 'Dune.2021.1080p.mkv');
    expect(dune).toMatchObject({
      state: 'present',
      duplicate: { kind: 'same-file', path: there, libraryName: 'Films', forced: null },
    });
    expect((await arrivals(h, '?state=present')).items.map(({ file }) => file)).toEqual([
      'Dune.2021.1080p.mkv',
    ]);
    expect((await arrivals(h, '?state=ready')).items).toEqual([]);
  });

  it('puts a copy of the same size in "present" too, and a bigger version in "review"', async () => {
    const { h, there, downloads } = await withDune();
    await put(join(downloads, 'Dune.2021.copy.mkv'), 'the same twenty-eight gigabytes');
    await put(join(downloads, 'Dune.2021.2160p.mkv'), 'a much heavier remux of the same film');
    await scanDownloads(h);

    const items = (await arrivals(h)).items;
    expect(items.find(({ file }) => file.includes('copy'))).toMatchObject({
      state: 'present',
      duplicate: { kind: 'same-size', path: there },
    });
    expect(items.find(({ file }) => file.includes('2160p'))).toMatchObject({
      state: 'review',
      duplicate: { kind: 'other-version', path: there },
    });
  });

  it('never transfers a duplicate with "Transfer all", and keeps the new films', async () => {
    const { h, roots, there, downloads } = await withDune();
    await link(there, join(downloads, 'Dune.2021.1080p.mkv'));
    await put(join(downloads, 'Alien.1979.mkv'), 'alien');
    const jobId = await scanDownloads(h);
    expect((await arrivals(h, '?state=ready')).items.map(({ file }) => file)).toEqual([
      'Alien.1979.mkv',
    ]);

    const run = await h.request('POST', `/api/plans/${jobId}/execute`);
    expect(run.statusCode).toBe(202);
    await h.app.jobs.idle();
    // Alien arrived; Dune is still the only version of Dune.
    expect(await readdir(join(roots.films, 'Dune (2021) {tmdb-438631}'))).toEqual([
      'Dune (2021) {tmdb-438631}.mkv',
    ]);
    expect(
      await readFile(
        join(roots.films, 'Alien (1979) {tmdb-348}', 'Alien (1979) {tmdb-348}.mkv'),
        'utf8',
      ),
    ).toBe('alien');
    expect((await arrivals(h, '?state=present')).items).toHaveLength(1);
  });

  it('lets the owner process a duplicate anyway: back to review with its reason', async () => {
    const { h, there, downloads } = await withDune();
    await link(there, join(downloads, 'Dune.2021.1080p.mkv'));
    await scanDownloads(h);
    const [dune] = (await arrivals(h)).items;

    const answer = await h.request('POST', `/api/entries/${dune?.id ?? ''}/process`);
    expect(answer.statusCode, answer.body).toBe(200);
    const after = await arrivals(h);
    expect(after.counts).toMatchObject({ present: 0, review: 1 });
    expect(after.items[0]).toMatchObject({
      state: 'review',
      duplicate: { kind: 'same-file', forced: 'asked' },
    });
  });

  it('recomputes the verdict when the owner validates another work or library', async () => {
    const { h, there, downloads, roots } = await withDune();
    await link(there, join(downloads, 'Mystery.Home.Video.mkv'));
    await scanDownloads(h);
    const [mystery] = (await arrivals(h)).items;
    // Nobody recognized it, so it carries no verdict yet.
    expect(mystery).toMatchObject({ state: 'unrecognized', duplicate: null });

    // Validated as Dune in the library that holds Dune: it is the same file.
    expect((await h.match(mystery?.id ?? '', DUNE)).statusCode).toBe(200);
    expect((await arrivals(h)).items[0]).toMatchObject({
      state: 'present',
      duplicate: { kind: 'same-file' },
    });
    // Sent to the other library, which holds nothing: the verdict goes.
    expect((await h.match(mystery?.id ?? '', { ...DUNE, libraryId: 'films-4k' })).statusCode).toBe(
      200,
    );
    expect((await arrivals(h)).items[0]).toMatchObject({ state: 'ready', duplicate: null });
    expect(roots.uhd).not.toBe(roots.films);
  });

  it('validating an other version confirms it: it goes out as a second version', async () => {
    const { h, downloads, roots } = await withDune();
    await put(join(downloads, 'Dune.2021.2160p.mkv'), 'a much heavier remux of the same film');
    const jobId = await scanDownloads(h);
    const [dune] = (await arrivals(h)).items;
    expect(dune?.state).toBe('review');

    expect((await h.match(dune?.id ?? '', DUNE)).statusCode).toBe(200);
    expect((await arrivals(h)).items[0]).toMatchObject({
      state: 'ready',
      duplicate: { kind: 'other-version', forced: 'confirmed' },
    });
    expect((await h.request('POST', `/api/plans/${jobId}/execute`)).statusCode).toBe(202);
    await h.app.jobs.idle();
    expect(await readdir(join(roots.films, 'Dune (2021) {tmdb-438631}'))).toHaveLength(2);
  });
});

describe('a release the series library partly or wholly holds', () => {
  const ZORP = { kind: 'series', id: { provider: 'tmdb', id: 77 }, title: 'Zorp', year: 2010 };

  /** The series library already holds E01 and E02 of Zorp, and the folder comes with the given episodes. */
  async function withZorp(episodes: number[]) {
    const world = await setup();
    const store = new LibraryItemStore(world.h.database);
    for (const number of [1, 2]) {
      const path = await put(
        join(world.roots.series, 'Zorp', 'Season 01', `Zorp - s01e0${String(number)}.mkv`),
        `episode ${String(number)}`,
      );
      store.put({
        libraryId: 'series',
        path,
        kind: 'series',
        tmdbId: 77,
        title: 'Zorp',
        year: 2010,
        season: 1,
        episode: number,
        episodeEnd: null,
        state: 'ok',
        nfo: null,
        poster: null,
        fanart: null,
        logo: null,
        thumb: null,
        entryId: null,
        scanJobId: null,
        scannedAt: '2026-01-01T00:00:00.000Z',
        unavailable: [],
        picture: null,
      });
    }
    for (const number of episodes) {
      await put(
        join(world.downloads, 'Pack', `Zorp.S01E0${String(number)}.mkv`),
        `episode ${String(number)}`,
      );
    }
    await scanDownloads(world.h);
    const [first] = (await arrivals(world.h)).items;
    expect((await world.h.match(first?.id ?? '', ZORP)).statusCode).toBe(200);
    return world;
  }

  it('moves the whole release to "present" when every episode is there', async () => {
    const { h } = await withZorp([1, 2]);
    const found = await arrivals(h);
    expect(found.items.map(({ state }) => state)).toEqual(['present', 'present']);
    expect(found.counts.present).toBe(2);
    expect((await arrivals(h, '?state=ready')).items).toEqual([]);
  });

  it('sets aside only the episodes already there, and keeps the ones to bring in', async () => {
    const { h } = await withZorp([1, 2, 3]);
    const [first] = (await arrivals(h)).items;
    const answer = await h.request('POST', `/api/entries/${first?.id ?? ''}/ignore-present`);
    expect(answer.json()).toEqual({ ignored: 2, held: 0 });
    const after = await arrivals(h);
    expect(after.items.map(({ file }) => file)).toEqual(['Zorp.S01E03.mkv']);
    expect(after.items[0]?.state).toBe('ready');
    // Nothing of it is left to set aside.
    const again = await h.request(
      'POST',
      `/api/entries/${after.items[0]?.id ?? ''}/ignore-present`,
    );
    expect(again.statusCode).toBe(409);
  });

  it('leaves a release with an episode to bring in where it is, and lists those already there', async () => {
    const { h } = await withZorp([1, 2, 3]);
    const found = await arrivals(h);
    expect(found.items.map(({ state }) => state)).toEqual(['ready', 'ready', 'ready']);
    expect(found.items[0]?.presentEpisodes.map(({ file }) => file)).toEqual([
      'Zorp.S01E01.mkv',
      'Zorp.S01E02.mkv',
    ]);
    expect(found.counts).toMatchObject({ ready: 3, present: 0 });
  });
});

describe('POST /api/entries/ignore', () => {
  /** Dune in Films, and `copies` same-size copies of it in the downloads, all "present". */
  async function withCopies(
    copies: number,
    extra: (downloads: string) => Promise<void> = () => Promise.resolve(),
  ) {
    const world = await setup();
    await put(DUNE_NAME(world.roots.films), 'dune');
    expect((await world.h.request('POST', '/api/libraries/films/scan')).statusCode).toBe(202);
    await world.h.app.jobs.idle();
    for (let n = 1; n <= copies; n++) {
      await put(join(world.downloads, `Dune.2021.copy${String(n)}.mkv`), 'dune');
    }
    await extra(world.downloads);
    const jobId = await scanDownloads(world.h);
    return { ...world, jobId };
  }

  it('sets a whole state aside in one request, beyond the page that was loaded', async () => {
    const { h } = await withCopies(5);
    expect((await arrivals(h, '?limit=2')).items).toHaveLength(2);
    expect((await arrivals(h)).counts.present).toBe(5);

    const answer = await h.request('POST', '/api/entries/ignore', { state: 'present' });
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json()).toEqual({ ignored: 5, held: 0 });
    expect((await arrivals(h)).counts).toEqual({
      ready: 0,
      review: 0,
      unrecognized: 0,
      present: 0,
    });
  });

  it('leaves alone what a transfer holds, and says how many', async () => {
    const { h, jobId } = await withCopies(3);
    const [held] = (await arrivals(h, '?state=present')).items;
    new ExecutionStore(h.database).create(jobId, [held?.id ?? '']);

    const answer = await h.request('POST', '/api/entries/ignore', { state: 'present' });
    expect(answer.json()).toEqual({ ignored: 2, held: 1 });
    expect((await arrivals(h, '?state=present')).items.map(({ id }) => id)).toEqual([held?.id]);
  });

  it('sets files aside by id, a series release with all its episodes', async () => {
    const { h } = await withCopies(1, async (downloads) => {
      for (const n of [1, 2, 3]) {
        await put(join(downloads, 'Pack', `Zorp.S01E0${String(n)}.mkv`));
      }
    });
    const items = (await arrivals(h)).items;
    const episode = items.find(({ file }) => file === 'Zorp.S01E01.mkv');
    const copy = items.find(({ file }) => file.includes('copy1'));

    const answer = await h.request('POST', '/api/entries/ignore', {
      ids: [episode?.id ?? '', copy?.id ?? '', 'not-an-entry'],
    });
    // Three episodes and the copy; an id nobody knows is not an error.
    expect(answer.json()).toEqual({ ignored: 4, held: 0 });
    expect((await arrivals(h)).total).toBe(0);
  });

  it('wants ids or a state, not both and not neither', async () => {
    const { h } = await withCopies(1);
    for (const body of [{}, { ids: [], state: 'present' }]) {
      const answer = await h.request('POST', '/api/entries/ignore', body);
      expect(answer.statusCode).toBe(422);
      expect(answer.json()).toMatchObject({ error: { code: 'request.invalid' } });
    }
    expect((await h.request('POST', '/api/entries/ignore', { state: 'nope' })).statusCode).toBe(
      400,
    );
  });

  it('announces one event for the whole batch', async () => {
    const { h } = await withCopies(4);
    const base = await h.app.listen({ host: '127.0.0.1', port: 0 });
    const auth = { authorization: `Bearer ${h.apiKey}` };
    const stream = await fetch(`${base}/api/events`, { headers: auth });
    const reader = stream.body?.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('event: ready')) {
      text += decoder.decode((await reader.read()).value);
    }
    text = '';
    await fetch(`${base}/api/entries/ignore`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'present' }),
    });
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      const next = await Promise.race([
        reader.read(),
        new Promise<undefined>((resolve) => {
          setTimeout(() => {
            resolve(undefined);
          }, 300);
        }),
      ]);
      if (next === undefined) {
        break;
      }
      text += decoder.decode(next.value);
    }
    await reader.cancel();
    expect(text.match(/event: arrivals/g)).toHaveLength(1);
  });
});
