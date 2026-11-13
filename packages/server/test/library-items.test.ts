import { rm } from 'node:fs/promises';
import { Database } from '@kinoshelf/core';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrated } from '../src/database.js';
import type { JournalEntry, MovieDetails } from '@kinoshelf/core';
import type { EntryStore } from '../src/entries.js';
import type { JobStore } from '../src/jobs.js';
import {
  LibraryItemStore,
  LibrarySnapshot,
  itemId,
  type LibraryItem,
  type ShowSort,
  type SortDirection,
  type StateFilter,
} from '../src/library-items.js';
import { cleanup, fakeProvider, harness, batchOf, makeDir, put } from './harness.js';

afterEach(cleanup);

/** A movie library organized in place, holding a new film, an unknown file and a well-placed film. */
async function scanned(metadata: 'none' | 'nfo' = 'nfo') {
  const root = await makeDir();
  const dune = await put(join(root, 'Dune.2021.mkv'), 'dune');
  const mystery = await put(join(root, 'Mystery.Home.Video.mkv'));
  const alien = await put(join(root, 'Alien (1979)', 'Alien (1979).mkv'), 'alien');
  const h = await harness({
    config: {
      libraries: [
        { id: 'films', name: 'Films', source: root, type: 'movie', naming: 'no-id', metadata },
        { id: 'shows', name: 'Shows', source: await makeDir(), type: 'series' },
      ],
    },
  });
  const store = new LibraryItemStore(h.database);
  const scan = await h.request('POST', '/api/libraries/films/scan');
  await h.app.jobs.idle();
  const jobId = scan.json<{ id: string }>().id;
  return { h, store, root, dune, mystery, alien, jobId };
}

describe('the snapshot of a library', () => {
  it('is written when a scan of the whole source ends', async () => {
    const { store, dune, mystery, alien } = await scanned();
    const byPath = new Map(store.all('films').map((item) => [item.path, item]));
    expect([...byPath.keys()].sort()).toEqual([alien, dune, mystery].sort());

    expect(byPath.get(dune)).toMatchObject({
      kind: 'movie',
      tmdbId: 438631,
      title: 'Dune',
      year: 2021,
      state: 'rename',
      // The profile writes an NFO and the images; nothing is there yet.
      nfo: false,
      poster: false,
      fanart: false,
      logo: false,
    });
    expect(byPath.get(mystery)).toMatchObject({
      kind: 'movie',
      tmdbId: null,
      state: 'unrecognized',
      nfo: null,
    });
    // Well placed, but its NFO is missing.
    expect(byPath.get(alien)).toMatchObject({ tmdbId: 348, state: 'incomplete', nfo: false });
    expect(byPath.get(dune)?.entryId).toEqual(expect.any(String));
  });

  it('is replaced as a whole by the next scan', async () => {
    const { h, store, dune, alien } = await scanned();
    // A file that disappeared leaves the snapshot at the next scan; nothing else is kept.
    await rm(dune);
    await h.request('POST', '/api/libraries/films/scan');
    await h.app.jobs.idle();
    const paths = store.all('films').map((item) => item.path);
    expect(paths).not.toContain(dune);
    expect(paths).toContain(alien);
  });

  it('follows a transfer, then its undo', async () => {
    const { h, store, root, dune, alien, jobId } = await scanned();
    const moved = join(root, 'Dune (2021)', 'Dune (2021).mkv');

    const execution = (await h.request('POST', `/api/plans/${jobId}/execute`)).json<{
      id: string;
    }>();
    await h.app.jobs.idle();

    expect(store.get('films', dune)).toBeUndefined();
    // The test has no network: the NFO is written, the images are not, so both stay incomplete.
    expect(store.get('films', moved)).toMatchObject({
      state: 'incomplete',
      nfo: true,
      title: 'Dune',
    });
    // The film stays where it is, and now has its NFO.
    expect(store.get('films', alien)).toMatchObject({ state: 'incomplete', nfo: true });

    const batchId = batchOf(h, execution.id);
    expect((await h.request('POST', `/api/batches/${batchId}/undo`)).statusCode).toBe(200);

    expect(store.get('films', moved)).toBeUndefined();
    expect(store.get('films', dune)).toMatchObject({ state: 'rename', nfo: false });
    expect(store.get('films', alien)).toMatchObject({ state: 'incomplete', nfo: false });
  });

  it('follows the work a human chose for a file nobody recognized', async () => {
    const { h, store, mystery } = await scanned();
    const row = store.get('films', mystery);
    expect(row?.state).toBe('unrecognized');

    const matched = await h.match(row?.entryId ?? '', {
      kind: 'movie',
      id: { provider: 'tmdb', id: 438631 },
      title: 'Dune',
      year: 2021,
    });
    expect(matched.statusCode).toBe(200);
    expect(store.get('films', mystery)).toMatchObject({
      state: 'rename',
      tmdbId: 438631,
      title: 'Dune',
      year: 2021,
      nfo: false,
    });
  });

  it('follows an arrival copied in, and keeps it when an undo cannot remove the last copy', async () => {
    const downloads = await makeDir();
    const films = await makeDir();
    const download = await put(join(downloads, 'Dune.2021.mkv'), 'dune');
    const h = await harness({
      config: {
        libraries: [
          { id: 'films', name: 'Films', source: films, type: 'movie' },
          { id: 'shows', name: 'Shows', source: await makeDir(), type: 'series' },
          {
            id: 'dl',
            name: 'Downloads',
            source: downloads,
            into: { movie: 'films', series: 'shows' },
          },
        ],
      },
    });
    const store = new LibraryItemStore(h.database);
    const jobId = (await h.request('POST', '/api/libraries/dl/scan')).json<{ id: string }>().id;
    await h.app.jobs.idle();
    const execution = (await h.request('POST', `/api/plans/${jobId}/execute`)).json<{
      id: string;
    }>();
    await h.app.jobs.idle();
    const [copied] = store.all('films');
    expect(copied?.path).toMatch(/Dune \(2021\).*\.mkv$/);

    // The download was deleted after seeding: the copy in the library is the only one left.
    await rm(download);
    const batchId = batchOf(h, execution.id);
    expect((await h.request('POST', `/api/batches/${batchId}/undo`)).statusCode).toBe(200);
    expect(store.all('films').map(({ path }) => path)).toEqual([copied?.path]);
  });

  it('is not kept for an arrival folder', async () => {
    const root = await makeDir();
    await put(join(root, 'Dune.2021.mkv'));
    const h = await harness({
      config: {
        libraries: [
          { id: 'films', name: 'Films', source: await makeDir(), type: 'movie' },
          { id: 'shows', name: 'Shows', source: await makeDir(), type: 'series' },
          {
            id: 'dl',
            name: 'Downloads',
            source: root,
            into: { movie: 'films', series: 'shows' },
          },
        ],
      },
    });
    await h.request('POST', '/api/libraries/dl/scan');
    await h.app.jobs.idle();
    expect(new LibraryItemStore(h.database).all('dl')).toEqual([]);
  });
});

interface ItemsBody {
  library: { id: string; type: string; path: string; profile: string; writes: unknown };
  scannedAt: string | null;
  scan: unknown;
  counts: Record<string, number>;
  total: number;
  items: {
    id: string;
    path: string;
    state: string;
    title: string | null;
    resolution: string | null;
    nfo: boolean | null;
    poster: boolean | null;
    fanart: boolean | null;
    logo: boolean | null;
    unavailable: string[];
    versions: { id: string; resolution: string | null; nfo: boolean | null }[];
  }[];
}

const list = async (h: Awaited<ReturnType<typeof scanned>>['h'], query = '') =>
  (await h.request('GET', `/api/libraries/films/items${query}`)).json<ItemsBody>();

describe('GET /api/libraries/:id/items', () => {
  it('lists the snapshot with its counts, by title', async () => {
    const { h, root, dune, alien } = await scanned();
    const body = await list(h);
    expect(body.library).toEqual({
      writes: { nfo: true, artwork: true, logo: true, thumb: false },
      collections: true,
    });
    expect(body.scannedAt).toEqual(expect.any(String));
    expect(body.scan).toBeNull();
    expect(body.counts).toEqual({
      all: 3,
      review: 0,
      rename: 1,
      unrecognized: 1,
      'missing-nfo': 2,
      'missing-artwork': 2,
      'multi-version': 0,
      'missing-episodes': 0,
      'missing-show-files': 0,
      'incomplete-versions': 0,
    });
    expect(body.total).toBe(3);
    // Alien, Dune, then the file nobody recognized, which has no title but its name.
    expect(body.items.map((item) => item.path)).toEqual([
      alien,
      dune,
      join(root, 'Mystery.Home.Video.mkv'),
    ]);
    expect(body.items[1]).toMatchObject({ title: 'Dune', nfo: false, state: 'rename' });
  });

  it('sorts an accented title with its letter, not after Z', async () => {
    const { h, store, root } = await scanned();
    const [base] = store.all('films');
    if (!base) {
      throw new Error('the scan stored nothing');
    }
    const make = (title: string, name: string): LibraryItem => ({
      ...base,
      path: join(root, name),
      title,
      tmdbId: null,
      entryId: null,
      scanJobId: null,
    });
    store.replace('films', [
      make('Zodiac', 'zodiac.mkv'),
      make('Ça : Bienvenue à Derry', 'ca.mkv'),
      make('Casablanca', 'casablanca.mkv'),
      make('Alien', 'alien.mkv'),
      make('Élite', 'elite.mkv'),
    ]);
    const body = await list(h);
    expect(body.items.map((item) => item.title)).toEqual([
      'Alien',
      'Ça : Bienvenue à Derry',
      'Casablanca',
      'Élite',
      'Zodiac',
    ]);
  });

  it('searches without caring for accents or case', async () => {
    const { h, store, root } = await scanned();
    const [base] = store.all('films');
    if (!base) {
      throw new Error('the scan stored nothing');
    }
    store.replace('films', [
      { ...base, path: join(root, 'ca.mkv'), title: 'Ça : Bienvenue à Derry', tmdbId: 1 },
      { ...base, path: join(root, 'casablanca.mkv'), title: 'Casablanca', tmdbId: 2 },
    ]);
    const titles = async (q: string) =>
      (await list(h, `?q=${encodeURIComponent(q)}`)).items.map((item) => item.title);
    expect(await titles('ÇA :')).toEqual(['Ça : Bienvenue à Derry']);
    expect(await titles('ca')).toEqual(['Ça : Bienvenue à Derry', 'Casablanca']);
    expect(await titles('bienvenue a derry')).toEqual(['Ça : Bienvenue à Derry']);
    expect(await titles('casa')).toEqual(['Casablanca']);
  });

  it('filters by state or missing file, searches, and pages', async () => {
    const { h, dune, alien } = await scanned();
    expect((await list(h, '?state=rename')).items.map((i) => i.path)).toEqual([dune]);
    expect((await list(h, '?state=missing-nfo')).items.map((i) => i.path)).toEqual([alien, dune]);
    expect((await list(h, '?state=missing-artwork')).total).toBe(2);
    // The title, or the file name, whatever the case.
    expect((await list(h, '?q=ALIEN')).items.map((i) => i.path)).toEqual([alien]);
    expect((await list(h, '?q=mystery.home')).total).toBe(1);
    expect((await list(h, '?q=100%25')).total).toBe(0);
    const page = await list(h, '?limit=1&offset=1');
    expect(page.items.map((i) => i.path)).toEqual([dune]);
    expect(page.total).toBe(3);
    // The counts ignore the filters.
    expect((await list(h, '?state=rename')).counts.all).toBe(3);
  });

  it('reads the resolution in the file name', async () => {
    const { h, root } = await scanned();
    await put(join(root, 'Alien.1979.1080p.mkv'));
    await h.request('POST', '/api/libraries/films/scan');
    await h.app.jobs.idle();
    // The same film as the well-placed one: one entry, two versions; the unsized one comes last.
    const found = (await list(h, '?q=1080p')).items;
    expect(found).toHaveLength(1);
    expect(found[0]?.versions.map((version) => version.resolution)).toEqual(['1080p', null]);
  });

  it('falls back to the picture the probe read when the name gives none', async () => {
    const { h, root, alien } = await scanned();
    await put(join(root, 'Alien.1979.1080p.mkv'));
    await h.request('POST', '/api/libraries/films/scan');
    await h.app.jobs.idle();
    await h.app.probes.idle();
    const before = (await list(h, '?q=1080p')).items;
    expect(before[0]?.versions.map((version) => version.resolution)).toEqual(['1080p', null]);
    // Only the probe knows the unnamed file's size; the name still wins where it speaks.
    const probe = new LibraryItemStore(h.database).probeOf('films', alien);
    if (!probe) {
      throw new Error('the file was not probed');
    }
    new LibraryItemStore(h.database).setProbe('films', alien, { ...probe, picture: '720p' });
    const after = (await list(h, '?q=1080p')).items;
    expect(after[0]?.versions.map((version) => version.resolution)).toEqual(['1080p', '720p']);
  });

  it('lists a file still to validate on its own, never as a version of the film it was mistaken for', async () => {
    const { h, store, root } = await scanned();
    const [base] = store.all('films');
    if (!base) {
      throw new Error('the scan stored nothing');
    }
    // The matcher took the second film for the first one: same tmdb id, but a human must decide.
    const placed = {
      ...base,
      path: join(root, 'Dragons 2.mkv'),
      title: 'Dragons 2',
      tmdbId: 90,
      state: 'ok' as const,
      entryId: 'placed',
    };
    const guess = {
      ...base,
      path: join(root, 'Dragons 3.mkv'),
      title: 'Dragons 3',
      tmdbId: 90,
      state: 'review' as const,
      entryId: 'guess',
    };
    store.replace('films', [placed, guess]);

    const body = await list(h);
    expect(body.total).toBe(2);
    expect(body.counts.all).toBe(2);
    expect(body.counts['multi-version']).toBe(0);
    const byPath = new Map(body.items.map((item) => [item.path, item]));
    expect(byPath.get(placed.path)?.versions).toHaveLength(1);
    const waiting = byPath.get(guess.path) as (typeof body.items)[number] & { entryId: string };
    expect(waiting.state).toBe('review');
    expect(waiting.versions).toHaveLength(1);
    // Validating it from the library reaches its own entry.
    expect(waiting.entryId).toBe('guess');
    expect((await list(h, '?state=review')).items.map((i) => i.path)).toEqual([guess.path]);

    // Its page does not list the placed film among its versions either.
    const page = await h.request('GET', `/api/libraries/films/items/${waiting.id}`);
    expect(page.json<{ versions: unknown[] }>().versions).toHaveLength(1);
  });

  it('says a library was scanned even when it held nothing, and not before', async () => {
    const root = await makeDir();
    const h = await harness({
      config: {
        libraries: [
          { id: 'films', name: 'Films', source: root, type: 'movie' },
          { id: 'shows', name: 'Shows', source: await makeDir(), type: 'series' },
        ],
      },
    });
    const before = (await h.request('GET', '/api/libraries/films/items')).json<ItemsBody>();
    expect(before).toMatchObject({ scannedAt: null, total: 0, scan: null });
    await h.request('POST', '/api/libraries/films/scan');
    await h.app.jobs.idle();
    const after = (await h.request('GET', '/api/libraries/films/items')).json<ItemsBody>();
    expect(after.scannedAt).toEqual(expect.any(String));
    expect(after.total).toBe(0);
  });

  it('refuses an unknown library and an arrival folder', async () => {
    const root = await makeDir();
    const h = await harness({
      config: {
        libraries: [
          { id: 'films', name: 'Films', source: await makeDir(), type: 'movie' },
          { id: 'shows', name: 'Shows', source: await makeDir(), type: 'series' },
          { id: 'dl', name: 'DL', source: root, into: { movie: 'films', series: 'shows' } },
        ],
      },
    });
    const ghost = await h.request('GET', '/api/libraries/ghost/items');
    expect([ghost.statusCode, ghost.json()]).toEqual([
      404,
      { error: { code: 'library.not-found' } },
    ]);
    const arrival = await h.request('GET', '/api/libraries/dl/items');
    expect(arrival.statusCode).toBe(409);
    expect(arrival.json()).toEqual({ error: { code: 'library.not-typed' } });
    expect((await h.request('GET', '/api/libraries/films/items?state=nope')).statusCode).toBe(400);
  });
});

describe('the logo of a library item', () => {
  it('is told apart from the other images, and keeps an item under missing-artwork', async () => {
    const root = await makeDir();
    const alienDir = join(root, 'Alien (1979)');
    const alien = await put(join(alienDir, 'Alien (1979).mkv'), 'alien');
    await put(join(alienDir, 'movie.nfo'), '<movie/>');
    await put(join(alienDir, 'poster.jpg'), 'image');
    await put(join(alienDir, 'fanart.jpg'), 'image');
    const dune = await put(join(root, 'Dune (2021)', 'Dune (2021).mkv'), 'dune');
    for (const name of ['movie.nfo', 'poster.jpg', 'fanart.jpg', 'clearlogo.png']) {
      await put(join(root, 'Dune (2021)', name), name);
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
          { id: 'shows', name: 'Shows', source: await makeDir(), type: 'series' },
        ],
      },
    });
    await h.request('POST', '/api/libraries/films/scan');
    await h.app.jobs.idle();

    const body = (await h.request('GET', '/api/libraries/films/items')).json<ItemsBody>();
    expect(body.library).toEqual({
      writes: { nfo: true, artwork: true, logo: true, thumb: false },
      collections: true,
    });
    const byPath = new Map(body.items.map((item) => [item.path, item]));
    expect(byPath.get(alien)).toMatchObject({ poster: true, fanart: true, logo: false });
    expect(byPath.get(alien)?.state).toBe('incomplete');
    expect(byPath.get(dune)).toMatchObject({ poster: true, fanart: true, logo: true });
    expect(byPath.get(dune)?.state).toBe('ok');
    const missing = (await list(h, '?state=missing-artwork')).items.map((item) => item.path);
    expect(missing).toEqual([alien]);
  });

  it('says a film TMDB has no logo for is unavailable, not present, unless one is on the disk', async () => {
    const root = await makeDir();
    const alien = await put(join(root, 'Alien (1979)', 'Alien (1979).mkv'), 'alien');
    await put(join(root, 'Alien (1979)', 'clearlogo.png'), 'by hand');
    const dune = await put(join(root, 'Dune.2021.mkv'), 'dune');
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
          { id: 'shows', name: 'Shows', source: await makeDir(), type: 'series' },
        ],
      },
      // The fake catalog gives every work a logo: this TMDB has none for any of them.
      createProvider: () => ({
        ...fakeProvider,
        getMovieDetails: async (id, language) => {
          const details = (await fakeProvider.getMovieDetails(id, language)) as MovieDetails;
          const { logoPath, ...withoutLogo } = details;
          return logoPath === undefined ? details : withoutLogo;
        },
      }),
    });
    await h.request('POST', '/api/libraries/films/scan');
    await h.app.jobs.idle();

    const items = new Map((await list(h)).items.map((item) => [item.path, item]));
    // To rename: nothing is on the disk and TMDB has no logo, so the dash, not a tick.
    expect(items.get(dune)).toMatchObject({ state: 'rename', logo: true, unavailable: ['logo'] });
    // Already in place with a logo the user added: there, nothing to say.
    expect(items.get(alien)).toMatchObject({ logo: true, unavailable: [] });
  });

  it('is not claimed when the profile writes none', async () => {
    const { h, alien } = await scanned('none');
    const item = (await list(h)).items.find((candidate) => candidate.path === alien);
    expect(item).toMatchObject({ logo: null });
  });
});

describe('GET /api/libraries/:id/items/:itemId', () => {
  interface ItemBody {
    id: string;
    title: string | null;
    overview: string | null;
    runtime: number | null;
    genres: string[];
    posterPath: string | null;
    file: {
      video: string | null;
      audio: string | null;
      hdr: string | null;
      audioLanguages: string[];
      subtitleLanguages: string[];
      size: number;
    } | null;
  }

  const itemOf = async (
    h: Awaited<ReturnType<typeof scanned>>['h'],
    path: string,
  ): Promise<ItemBody | undefined> => {
    const list = (await h.request('GET', '/api/libraries/films/items')).json<{
      items: { id: string; path: string }[];
    }>();
    const id = list.items.find((item) => item.path === path)?.id;
    const response = await h.request('GET', `/api/libraries/films/items/${id ?? 'unknown'}`);
    return response.statusCode === 200 ? response.json<ItemBody>() : undefined;
  };

  it('adds the work and the file to the item', async () => {
    const { h, dune } = await scanned();
    expect(await itemOf(h, dune)).toMatchObject({
      title: 'Dune',
      genres: [],
      overview: null,
      file: {
        video: 'h264',
        audio: 'aac 2.0',
        hdr: null,
        audioLanguages: ['eng', 'fre'],
        subtitleLanguages: ['fre'],
        size: 4,
      },
    });
  });

  it('is answered even when the file cannot be read, or the work is unknown', async () => {
    const { h, mystery } = await scanned();
    expect(await itemOf(h, mystery)).toMatchObject({ title: 'Mystery Home Video' });
  });

  it('answers 404 for an item that is not in the library', async () => {
    const { h } = await scanned();
    const response = await h.request('GET', '/api/libraries/films/items/0123456789abcdef');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: 'library.item-not-found' } });
    expect((await h.request('GET', '/api/libraries/ghost/items/x')).statusCode).toBe(404);
  });
});

describe('probing after a scan', () => {
  it('reads every video once the queue is idle, and not again on a rescan', async () => {
    const { h, store, dune, alien, mystery } = await scanned();
    await h.app.probes.idle();
    expect([dune, alien, mystery].map((path) => store.probeOf('films', path)?.video)).toEqual([
      'h264',
      'h264',
      'h264',
    ]);
    expect(store.unprobed('films')).toEqual([]);

    await h.request('POST', '/api/libraries/films/scan');
    await h.app.jobs.idle();
    await h.app.probes.idle();
    expect(store.unprobed('films')).toEqual([]);
  });

  it('is picked up again after a restart, from the rows never probed', async () => {
    const { h, store, dune } = await scanned();
    await h.app.probes.idle();
    // A crash left a row without a probe.
    h.database.prepare('UPDATE library_items SET probed_at = NULL WHERE path = ?').run(dune);
    expect(store.unprobed('films')).toEqual([dune]);
    h.app.probes.rebuild(['films']);
    await h.app.probes.idle();
    expect(store.unprobed('films')).toEqual([]);
  });
});

describe('POST /api/libraries/:id/execute', () => {
  const dryRun = (h: Awaited<ReturnType<typeof scanned>>['h'], items: string[]) =>
    h.request('POST', '/api/libraries/films/execute', { items, dryRun: true });

  it('previews a selection, then renames and completes it under one batch', async () => {
    const { h, store, root, dune, alien } = await scanned();
    const moved = join(root, 'Dune (2021)', 'Dune (2021).mkv');

    const preview = await dryRun(h, [itemId(dune), itemId(alien)]);
    expect(preview.statusCode).toBe(200);
    const report = preview.json<{
      items: { entryId: string; results: { type: string; destination: string }[] }[];
      skipped: string[];
    }>();
    expect(report.skipped).toEqual([]);
    const types = report.items.flatMap((i) => i.results.map((r) => r.type));
    expect(types.filter((type) => type !== 'download').sort()).toEqual([
      'transfer',
      'write-file',
      'write-file',
    ]);
    // Nothing was written.
    expect(store.get('films', dune)?.state).toBe('rename');

    const run = await h.request('POST', '/api/libraries/films/execute', {
      items: [itemId(dune), itemId(alien)],
    });
    expect(run.statusCode).toBe(202);
    expect(run.json<{ executions: unknown[] }>().executions).toHaveLength(1);
    await h.app.jobs.idle();
    expect(store.get('films', moved)).toMatchObject({ nfo: true });
    expect(store.get('films', alien)).toMatchObject({ nfo: true });

    // One batch, in the history.
    const history = (await h.request('GET', '/api/history')).json<{ items: { kind: string }[] }>();
    expect(history.items).toHaveLength(1);
    expect(history.items[0]?.kind).toBe('batch');
  });

  it('completes an item alone, and leaves the others as they were', async () => {
    const { h, store, dune, alien } = await scanned();
    const run = await h.request('POST', '/api/libraries/films/execute', { items: [itemId(alien)] });
    expect(run.statusCode).toBe(202);
    await h.app.jobs.idle();
    expect(store.get('films', alien)).toMatchObject({ nfo: true });
    expect(store.get('films', dune)?.state).toBe('rename');
  });

  it('skips what has nothing to do, and refuses a selection with nothing left', async () => {
    const { h, mystery, dune } = await scanned();
    // A file nobody recognized has no plan.
    const mixed = await dryRun(h, [itemId(dune), itemId(mystery), 'unknown']);
    expect(mixed.json<{ skipped: string[] }>().skipped.sort()).toEqual(
      [itemId(mystery), 'unknown'].sort(),
    );
    const none = await dryRun(h, [itemId(mystery)]);
    expect(none.statusCode).toBe(409);
    expect(none.json()).toEqual({ error: { code: 'library.nothing-to-do' } });

    // Run once: a second request finds nothing executable.
    await h.request('POST', '/api/libraries/films/execute', { items: [itemId(dune)] });
    await h.app.jobs.idle();
    expect((await dryRun(h, [itemId(dune)])).statusCode).toBe(409);
  });

  it('refuses to queue again an item a batch still holds', async () => {
    const { h, dune, alien } = await scanned();
    const first = await h.request('POST', '/api/libraries/films/execute', {
      items: [itemId(dune)],
    });
    expect(first.statusCode).toBe(202);
    // The first batch has not ended: the same item, alone or in a bigger selection, is held.
    for (const items of [[itemId(dune)], [itemId(dune), itemId(alien)]]) {
      const again = await h.request('POST', '/api/libraries/films/execute', { items });
      expect(again.statusCode).toBe(409);
      expect(again.json()).toEqual({ error: { code: 'library.transfer-in-progress' } });
    }
    // Another item is free, and a preview never writes: both stay allowed.
    expect((await dryRun(h, [itemId(dune)])).statusCode).toBe(200);
    expect(
      (await h.request('POST', '/api/libraries/films/execute', { items: [itemId(alien)] }))
        .statusCode,
    ).toBe(202);
    await h.app.jobs.idle();
  });

  it('refuses an empty selection', async () => {
    const { h } = await scanned();
    expect(
      (await h.request('POST', '/api/libraries/films/execute', { items: [] })).statusCode,
    ).toBe(400);
  });
});

describe('the lookups of the item store', () => {
  const row = (path: string, extra: Partial<LibraryItem> = {}): LibraryItem => ({
    libraryId: 'shows',
    path,
    kind: 'series',
    tmdbId: 1,
    title: 'Show',
    year: null,
    season: 1,
    episode: 1,
    episodeEnd: null,
    state: 'ok',
    nfo: true,
    poster: null,
    fanart: null,
    logo: null,
    thumb: null,
    entryId: null,
    scanJobId: null,
    scannedAt: '2026-11-02T00:00:00.000Z',
    unavailable: [],
    picture: null,
    ...extra,
  });

  it('keeps the images TMDB has none of, and says nothing for a row without any', () => {
    const store = new LibraryItemStore(migrated(new Database(':memory:')));
    store.put(row('/a.mkv', { unavailable: ['logo', 'fanart'] }));
    store.put(row('/b.mkv'));
    expect(store.get('shows', '/a.mkv')?.unavailable).toEqual(['logo', 'fanart']);
    expect(store.get('shows', '/b.mkv')?.unavailable).toEqual([]);
  });

  it('counts the files to validate as a validation settles them: a release is one', () => {
    const database = migrated(new Database(':memory:'));
    const store = new LibraryItemStore(database);
    const entry = database.prepare(
      `INSERT INTO job_entries (id, job_id, path, classification, parsed, outcome, release, cluster)
       VALUES (?, 'j', ?, 'review', '{}', '{}', ?, ?)`,
    );
    const waiting = (path: string, id: string | null, kind: 'series' | 'movie' = 'series') =>
      row(path, { kind, state: 'review', entryId: id });
    for (const [id, path, release, cluster] of [
      ['a', '/in/Foundation/1.mkv', '/in/Foundation', 0],
      ['b', '/in/Foundation/2.mkv', '/in/Foundation', 0],
      ['c', '/in/Foundation/3.mkv', '/in/Foundation', 1],
    ] as const) {
      entry.run(id, path, release, cluster);
      store.put(waiting(path, id));
    }
    store.put(waiting('/in/Film.mkv', null, 'movie'));
    store.put(waiting('/in/Odd.mkv', null));

    const page = store.page('shows', { filter: 'review', limit: 1, offset: 0 });
    expect(page.total).toBe(5);
    // Foundation (main), Foundation (set apart), the film, the lone episode: the page cut changes nothing.
    expect(page.groups).toBe(4);
    expect(page.items).toHaveLength(1);
    // The tab says what the node does, not the number of files.
    expect(store.counts('shows', true).review).toBe(4);
    expect(store.counts('shows').review).toBe(5);
  });

  it('finds the videos of one folder, not of its sub-folders nor of a folder named alike', () => {
    const store = new LibraryItemStore(migrated(new Database(':memory:')));
    for (const path of [
      '/lib/Show/Season 01/a.mkv',
      '/lib/Show/Season 01/b.mkv',
      '/lib/Show/Season 01/Extras/c.mkv',
      '/lib/Show/Season 010/d.mkv',
      '/lib/Show/Season 01 (copy)/e.mkv',
      '/lib/Show/Season 01-old/f.mkv',
    ]) {
      store.put(row(path));
    }
    store.put(row('/lib/Show/Season 01/a.mkv', { libraryId: 'other' }));

    expect(store.inFolder('shows', '/lib/Show/Season 01').map(({ path }) => path)).toEqual([
      '/lib/Show/Season 01/a.mkv',
      '/lib/Show/Season 01/b.mkv',
    ]);
  });

  it('orders the shows by title, year or what they lack, either way', () => {
    const database = migrated(new Database(':memory:'));
    const store = new LibraryItemStore(database);
    const show = (tmdbId: number, title: string, year: number, missing: number | null): void => {
      store.put(row(`/lib/${title}/1.mkv`, { tmdbId, title, year }));
      if (missing !== null) {
        database
          .prepare(
            `INSERT INTO series_completeness (library_id, tmdb_id, missing, signature, computed_at)
             VALUES ('shows', ?, ?, '', '')`,
          )
          .run(tmdbId, missing);
      }
    };
    show(1, 'Foundation', 2021, 25);
    show(2, 'Severance', 2022, 1);
    show(3, 'The Expanse', 2015, 6);
    show(4, 'Andor', 2022, null);
    const titles = (sort?: ShowSort, dir?: SortDirection): (string | null)[] =>
      store
        .shows('shows', { limit: 50, offset: 0, ...(sort && { sort }), ...(dir && { dir }) })
        .items.map((item) => item.title);

    expect(titles()).toEqual(['Andor', 'Foundation', 'Severance', 'The Expanse']);
    expect(titles('title', 'desc')).toEqual(['The Expanse', 'Severance', 'Foundation', 'Andor']);
    // A year's first click is the newest, ties by title.
    expect(titles('year')).toEqual(['Andor', 'Severance', 'Foundation', 'The Expanse']);
    expect(titles('year', 'asc')).toEqual(['The Expanse', 'Foundation', 'Andor', 'Severance']);
    // A show not counted yet comes last whichever way.
    expect(titles('missing')).toEqual(['Foundation', 'The Expanse', 'Severance', 'Andor']);
    expect(titles('missing', 'asc')).toEqual(['Severance', 'The Expanse', 'Foundation', 'Andor']);
  });

  it('reads the shows held in several versions once, until a row changes', () => {
    const database = migrated(new Database(':memory:'));
    const store = new LibraryItemStore(database);
    // The size is read from the name: two sizes of one episode are two versions.
    const episode = (path: string): LibraryItem => row(path, { tmdbId: 7 });
    store.put(episode('/lib/A/1 - 1080p.mkv'));
    let reads = 0;
    const prepare = database.prepare.bind(database) as (text: string) => unknown;
    (database as unknown as { prepare: (text: string) => unknown }).prepare = (text) => {
      // The rows read whole, to tell the versions apart (not the ids of the shows).
      if (
        text.includes('SELECT library_id, path, kind') &&
        text.includes("library_id = ? AND kind = 'series' AND tmdb_id IS NOT NULL")
      ) {
        reads += 1;
      }
      return prepare(text);
    };
    const multi = (): number => store.shows('shows', { multi: true, limit: 50, offset: 0 }).total;
    expect(multi()).toBe(0);
    store.counts('shows', true);
    store.counts('shows', true);
    expect(reads).toBe(1);

    // A second version arrives: the answer follows it.
    store.put(episode('/lib/A/1 - 2160p.mkv'));
    expect(multi()).toBe(1);
    expect(reads).toBe(2);
    store.remove('shows', '/lib/A/1 - 2160p.mkv');
    expect(multi()).toBe(0);
    (database as unknown as { prepare: unknown }).prepare = prepare;
  });

  describe('the collection filters of a movie list', () => {
    const setup = () => {
      const database = migrated(new Database(':memory:'));
      const store = new LibraryItemStore(database);
      // Dune and Alien (two versions) are in a saga of three, Cube in none.
      store.put(film('/a/dune.mkv', 'Dune', 1, { nfo: false }));
      store.put(film('/a/alien - 1080p.mkv', 'Alien', 2, { nfo: true }));
      store.put(film('/a/alien - 2160p.mkv', 'Alien', 2, { nfo: false }));
      store.put(film('/a/cube.mkv', 'Cube', 3, { nfo: true }));
      const file = (total: number): void => {
        database
          .prepare(
            `UPDATE library_items SET collection_key = 't:9', collection_name = 'Saga',
               collection_total = ? WHERE library_id = 'films' AND tmdb_id IN (1, 2)`,
          )
          .run(total);
        // The test writes the rows behind the store's back: it is told which works changed.
        (store as unknown as { staleWork: (id: string, keys: 'all') => void }).staleWork(
          'films',
          'all',
        );
      };
      file(3);
      const titles = (
        options: Parameters<LibraryItemStore['page']>[1] extends infer O ? Partial<O> : never,
      ) =>
        store.page('films', { limit: 50, offset: 0, ...options }).items.map((item) => item.title);
      return { database, store, file, titles };
    };

    it('keeps a movie by its collection, whatever its versions and the other filters', () => {
      const { store, file, titles } = setup();
      expect(titles({ collection: 'in' })).toEqual(['Alien', 'Dune']);
      expect(titles({ collection: 'out' })).toEqual(['Cube']);
      expect(titles({ collection: { key: 't:9' } })).toEqual(['Alien', 'Dune']);
      expect(titles({ collection: 'incomplete' })).toEqual(['Alien', 'Dune']);
      // A state is asked of the work's files, the collection of the work.
      expect(titles({ collection: 'in', filter: 'missing-nfo' })).toEqual(['Alien', 'Dune']);
      expect(titles({ collection: 'in', multi: true })).toEqual(['Alien']);
      expect(titles({ collection: 'out', filter: 'missing-nfo' })).toEqual([]);
      expect(titles({ collection: 'in', query: 'dun' })).toEqual(['Dune']);
      expect(store.page('films', { collection: 'in', limit: 50, offset: 0 }).total).toBe(2);
      expect(store.collectionCounts('films')).toEqual({ all: 3, in: 2, out: 1, incomplete: 2 });

      // Holding the whole saga (two movies of two) is no longer incomplete.
      file(2);
      expect(titles({ collection: 'incomplete' })).toEqual([]);
      expect(store.collectionCounts('films')).toEqual({ all: 3, in: 2, out: 1, incomplete: 0 });
    });

    it('is sought in the index of the collections, not read from the whole library', () => {
      const { database, store } = setup();
      const sent: string[] = [];
      const prepare = database.prepare.bind(database) as (text: string) => unknown;
      (database as unknown as { prepare: (text: string) => unknown }).prepare = (text) => {
        sent.push(text);
        return prepare(text);
      };
      for (const collection of ['in', 'incomplete', { key: 't:9' }] as const) {
        store.page('films', { collection, limit: 50, offset: 0 });
      }
      store.collectionCounts('films');
      (database as unknown as { prepare: unknown }).prepare = prepare;

      const lists = sent.filter((text) => text.includes('FROM library_works'));
      expect(lists.length).toBeGreaterThan(0);
      for (const text of lists) {
        const plan = database
          .prepare(`EXPLAIN QUERY PLAN ${text}`)
          .all(...placeholders(text))
          .map((step) => (step as { detail: string }).detail)
          .join('\n');
        // The old shapes: the collected rows searched for each work (EXISTS), and the held count
        // read from an index with no collection to seek, which reads the whole library per row.
        expect(plan, text).not.toMatch(/EXISTS USING INDEX/);
        expect(plan, text).not.toMatch(/SCAN held/);
      }
    });
  });

  it('finds the shows holding a file of a state once, not by a sub-query per episode', () => {
    const database = migrated(new Database(':memory:'));
    const store = new LibraryItemStore(database);
    store.put(row('/lib/A/1.mkv', { tmdbId: 1, state: 'rename' }));
    store.put(row('/lib/A/2.mkv', { tmdbId: 1 }));
    store.put(row('/lib/B/1.mkv', { tmdbId: 2 }));
    const { grouped, params } = (
      store as unknown as {
        groupedShows: (id: string, options: object) => { grouped: string; params: unknown[] };
      }
    ).groupedShows('shows', { state: 'rename' });
    const plan = database
      .prepare(`EXPLAIN QUERY PLAN ${grouped}`)
      .all(...(params as never[]))
      .map((step) => (step as { detail: string }).detail)
      .join('\n');
    // A correlated EXISTS walks every episode of the show for each row: 100 ms on 20 000 files.
    expect(plan).not.toContain('EXISTS');
    expect(store.shows('shows', { state: 'rename', limit: 50, offset: 0 }).items).toHaveLength(1);
  });

  it('reads the flags of the works for a state, and the files once for a search, never per row', () => {
    const database = migrated(new Database(':memory:'));
    const store = new LibraryItemStore(database);
    store.put(film('/a.mkv', 'Alien', 1, { nfo: false }));
    const sql: string[] = [];
    const prepare = database.prepare.bind(database) as (text: string) => unknown;
    (database as unknown as { prepare: (text: string) => unknown }).prepare = (text) => {
      sql.push(text);
      return prepare(text);
    };
    store.page('films', { filter: 'missing-nfo', limit: 50, offset: 0 });
    store.page('films', { query: 'ali', limit: 50, offset: 0 });
    store.page('films', { filter: 'rename', query: 'ali', limit: 50, offset: 0 });
    (database as unknown as { prepare: unknown }).prepare = prepare;

    const lists = sql.filter(
      (text) => text.startsWith('SELECT') && text.includes('FROM library_works'),
    );
    expect(lists).toHaveLength(2 * 3);
    for (const text of lists) {
      const plan = database
        .prepare(`EXPLAIN QUERY PLAN ${text}`)
        .all(...(text.match(/\?/g) ?? []).map(() => null))
        .map((step) => (step as { detail: string }).detail)
        .join('\n');
      // An EXISTS over the work's files for each lead row cost 10 ms a statement at 20 000 files.
      expect(plan, text).not.toMatch(/EXISTS|CORRELATED/);
    }
  });

  it('searches the title and the file name from a stored key, never calling sort_key', () => {
    const database = migrated(new Database(':memory:'));
    const store = new LibraryItemStore(database);
    store.put(film('/movies/a.mkv', 'Alien', 1, { nfo: false }));
    store.put(film('/movies/Dune.2021.2160p.mkv', 'Dune', 2));
    store.page('films', { limit: 1, offset: 0 }); // settles the works, which folds a collection's name
    let calls = 0;
    database.function('sort_key', { deterministic: true }, (value: unknown) => {
      calls += 1;
      return typeof value === 'string' ? value.toLowerCase() : null;
    });
    const titles = (query: string, filter?: 'missing-nfo'): string[] =>
      store
        .page('films', { query, ...(filter ? { filter } : {}), limit: 50, offset: 0 })
        .items.map((item) => item.title ?? '');
    expect(titles('ali')).toEqual(['Alien']);
    expect(titles('2160P')).toEqual(['Dune']);
    expect(titles('ali', 'missing-nfo')).toEqual(['Alien']);
    // A folder's name is not a match: "movies" would otherwise list the whole library.
    expect(titles('movies')).toEqual([]);
    expect(calls).toBe(0);
  });

  it('keeps the rows of its works as a rebuild from the files would, whatever was written', () => {
    const database = migrated(new Database(':memory:'));
    const store = new LibraryItemStore(database);
    const summary = (): unknown[] =>
      database.prepare('SELECT * FROM library_works ORDER BY library_id, work_key').all();
    const read = (): void => void store.page('films', { limit: 50, offset: 0 });
    const rebuilt = (): unknown[] => {
      (store as unknown as { staleWorks: Map<string, string> }).staleWorks.set('films', 'all');
      read();
      return summary();
    };
    for (const id of [1, 2, 3]) {
      store.put(film(`/m/${String(id)}/a.mkv`, `Film ${String(id)}`, id));
    }
    read();
    // Each kind of write, read after each: a state, a second version, a move, a removal, a file settled as
    // another film, a scan of one folder, and a collection rewritten.
    store.put(film('/m/1/a.mkv', 'Film 1', 1, { nfo: false, state: 'rename' }));
    read();
    expect(summary()).toEqual(rebuilt());
    store.put(film('/m/2/a - 2160p.mkv', 'Film 2', 2));
    read();
    expect(summary()).toEqual(rebuilt());
    expect(
      store.page('films', { multi: true, limit: 50, offset: 0 }).items.map((i) => i.tmdbId),
    ).toEqual([2]);
    store.rename('films', '/m/3/a.mkv', '/m/3/z.mkv');
    read();
    expect(summary()).toEqual(rebuilt());
    store.put(film('/m/2/a - 2160p.mkv', 'Film 9', 9));
    read();
    expect(summary()).toEqual(rebuilt());
    store.remove('films', '/m/3/z.mkv');
    read();
    expect(summary()).toEqual(rebuilt());
    store.replace('films', [film('/m/1/a.mkv', 'Film 1', 1)], '/m/1');
    read();
    expect(summary()).toEqual(rebuilt());
    database
      .prepare(
        `INSERT INTO collections (id, name, overview, parts) VALUES (5, 'Saga', NULL, '[1,2,9]')`,
      )
      .run();
    database
      .prepare('INSERT INTO movie_collections (movie_id, collection_id) VALUES (1, 5), (9, 5)')
      .run();
    store.refreshMovies('films', [1, 9]);
    read();
    expect(summary()).toEqual(rebuilt());
    expect(store.collectionCounts('films')).toMatchObject({ in: 2, incomplete: 2 });
  });

  it('keeps the rows of its shows as a rebuild from the files would, whatever was written', () => {
    const database = migrated(new Database(':memory:'));
    const store = new LibraryItemStore(database);
    const episode = (path: string, show: number, season: number, number: number, over = {}) =>
      row(path, {
        kind: 'series',
        tmdbId: show,
        title: `Show ${String(show)}`,
        season,
        episode: number,
        ...over,
      });
    const summary = (): unknown[] =>
      database.prepare('SELECT * FROM library_shows ORDER BY library_id, tmdb_id').all();
    const rebuilt = (): unknown[] => {
      (store as unknown as { staleShows: Map<string, string> }).staleShows.set('shows', 'all');
      store.shows('shows', { limit: 50, offset: 0 });
      return summary();
    };
    const read = (): void => void store.shows('shows', { limit: 50, offset: 0 });

    for (const show of [1, 2, 3]) {
      store.put(episode(`/s/${String(show)}/a.mkv`, show, 1, 1));
      store.put(episode(`/s/${String(show)}/b.mkv`, show, 1, 2));
    }
    read();
    // Each kind of write, read after each: a state, a second version, a probe, a move, a removal, a
    // show changing its id, and a scan of one folder.
    store.put(episode('/s/1/a.mkv', 1, 1, 1, { state: 'rename', nfo: false }));
    read();
    expect(summary()).toEqual(rebuilt());
    store.put(episode('/s/2/a - 2160p.mkv', 2, 1, 1));
    read();
    expect(summary()).toEqual(rebuilt());
    expect(
      store.shows('shows', { multi: true, limit: 50, offset: 0 }).items.map((s) => s.tmdbId),
    ).toEqual([2]);
    store.setProbe('shows', '/s/2/a - 2160p.mkv', {
      video: null,
      audio: null,
      hdr: null,
      audioLanguages: [],
      subtitleLanguages: [],
      picture: '2160p',
      size: 1,
      mtime: 1,
      probedAt: '2026-11-13T00:00:00.000Z',
    } as never);
    read();
    expect(summary()).toEqual(rebuilt());
    store.rename('shows', '/s/3/a.mkv', '/s/3/z.mkv');
    read();
    expect(summary()).toEqual(rebuilt());
    store.remove('shows', '/s/3/b.mkv');
    store.remove('shows', '/s/3/z.mkv');
    expect(store.shows('shows', { limit: 50, offset: 0 }).items.map((s) => s.tmdbId)).toEqual([
      1, 2,
    ]);
    expect(summary()).toEqual(rebuilt());
    store.put(episode('/s/1/b.mkv', 7, 1, 2));
    read();
    expect(summary()).toEqual(rebuilt());
    store.replace('shows', [episode('/s/2/a.mkv', 2, 1, 1)], '/s/2');
    read();
    expect(summary()).toEqual(rebuilt());
  });

  it('counts the shows lacking episodes or files', () => {
    const database = migrated(new Database(':memory:'));
    const store = new LibraryItemStore(database);
    for (const id of [1, 2, 3, 4]) {
      store.put(row(`/lib/S${id}/1.mkv`, { tmdbId: id }));
      store.put(row(`/lib/S${id}/2.mkv`, { tmdbId: id }));
    }
    const completeness = database.prepare(
      `INSERT INTO series_completeness (library_id, tmdb_id, missing, signature, computed_at)
       VALUES ('shows', ?, ?, '', '')`,
    );
    // 1 and 3 lack episodes, 2 does not, 4 was not counted yet; 9 is a show no row holds any more.
    for (const [id, missing] of [
      [1, 3],
      [2, 0],
      [3, 1],
      [9, 5],
    ] as const) {
      completeness.run(id, missing);
    }
    const files = database.prepare(
      `INSERT INTO series_files (library_id, tmdb_id, season, nfo, poster, fanart, logo)
       VALUES ('shows', ?, -1, ?, ?, 1, 1)`,
    );
    // 2 lacks its NFO, 3 its poster (but TMDB has none: not missing), 4 nothing, 9 is gone.
    for (const [id, nfo, poster] of [
      [1, 1, 1],
      [2, 0, 1],
      [3, 1, 0],
      [4, 1, 1],
      [9, 0, 0],
    ] as const) {
      files.run(id, nfo, poster);
    }
    database.prepare(`UPDATE library_items SET unavailable = '["poster"]' WHERE tmdb_id = 3`).run();

    const counts = store.counts('shows', true);
    expect(counts['missing-episodes']).toBe(2);
    expect(counts['missing-show-files']).toBe(1);
    expect(counts.all).toBe(4);
  });

  it('counts a movie library as the lists it opens', () => {
    const store = new LibraryItemStore(migrated(new Database(':memory:')));
    // A work with two versions, one lacking its NFO; one lacking artwork; a film to rename; two files
    // waiting for a person (one guessing the id of a film that is held, which makes it no version of it).
    store.put(film('/a/alien - 1080p.mkv', 'Alien', 1, { nfo: true }));
    store.put(film('/a/alien - 2160p.mkv', 'Alien', 1, { nfo: false }));
    store.put(film('/b/blade.mkv', 'Blade', 2, { poster: false }));
    store.put(film('/c/cube.mkv', 'Cube', 3, { state: 'rename' }));
    store.put(film('/d/guess.mkv', 'Guess', 1, { state: 'review' }));
    store.put(film('/e/lost.mkv', 'Lost', 5, { state: 'unrecognized' }));
    // Blade is held once: a file waiting for a person that guesses its id does not make it two versions.
    store.put(film('/g/guess.mkv', 'Blade?', 2, { state: 'review' }));
    store.put(film('/f/dune - 1080p.mkv', 'Dune', 6));
    store.put(film('/f/dune - 2160p.mkv', 'Dune', 6, { state: 'rename' }));

    const counts = store.counts('films');
    expect(counts).toMatchObject({
      all: 7,
      review: 2,
      rename: 2,
      unrecognized: 1,
      'missing-nfo': 1,
      'missing-artwork': 1,
      'multi-version': 2,
      'incomplete-versions': 0,
    });
    // Each count is the total of the list its filter opens.
    for (const filter of [
      'review',
      'rename',
      'unrecognized',
      'missing-nfo',
      'missing-artwork',
    ] as const) {
      expect(store.page('films', { filter, limit: 50, offset: 0 }).total, filter).toBe(
        counts[filter],
      );
    }
    expect(store.page('films', { multi: true, limit: 50, offset: 0 }).total).toBe(
      counts['multi-version'],
    );
    expect(store.page('films', { limit: 50, offset: 0 }).total).toBe(counts.all);
  });

  it('keeps the counts of the rows until a row changes, and never hands out the kept object', () => {
    const store = new LibraryItemStore(migrated(new Database(':memory:')));
    store.put(row('/lib/A/1.mkv', { tmdbId: 1, nfo: false }));
    const first = store.counts('shows', true);
    expect(first).toMatchObject({ all: 1, 'missing-nfo': 1 });
    // A caller changing what it was given must not change what the next one gets.
    (first as { all: number }).all = 99;
    expect(store.counts('shows', true).all).toBe(1);

    store.put(row('/lib/B/1.mkv', { tmdbId: 2, nfo: true }));
    expect(store.counts('shows', true)).toMatchObject({ all: 2, 'missing-nfo': 1 });
    store.put(row('/lib/B/1.mkv', { tmdbId: 2, nfo: false }));
    expect(store.counts('shows', true)).toMatchObject({ all: 2, 'missing-nfo': 2 });
    store.remove('shows', '/lib/A/1.mkv');
    expect(store.counts('shows', true)).toMatchObject({ all: 1, 'missing-nfo': 1 });
    store.forget('shows');
    expect(store.counts('shows', true).all).toBe(0);
  });

  it('keeps the works held in several versions that also match a state', () => {
    const store = new LibraryItemStore(migrated(new Database(':memory:')));
    store.put(film('/a/1080p.mkv', 'Alien', 1, { nfo: false }));
    store.put(film('/a/2160p.mkv', 'Alien', 1, { nfo: true }));
    store.put(film('/b/b.mkv', 'Blade', 2, { nfo: false }));
    store.put(film('/c/1080p.mkv', 'Cube', 3, { nfo: true }));
    store.put(film('/c/2160p.mkv', 'Cube', 3, { nfo: true }));
    const titles = (options: { filter?: StateFilter; multi?: boolean }): (string | null)[] =>
      store.page('films', { ...options, limit: 50, offset: 0 }).items.map((item) => item.title);

    expect(titles({ multi: true })).toEqual(['Alien', 'Cube']);
    expect(titles({ filter: 'missing-nfo' })).toEqual(['Alien', 'Blade']);
    expect(titles({ filter: 'missing-nfo', multi: true })).toEqual(['Alien']);
  });

  it('finds the files of one show of a library', () => {
    const store = new LibraryItemStore(migrated(new Database(':memory:')));
    store.put(row('/lib/A/1.mkv', { tmdbId: 1 }));
    store.put(row('/lib/A/2.mkv', { tmdbId: 1 }));
    store.put(row('/lib/B/1.mkv', { tmdbId: 2 }));
    store.put(row('/lib/A/3.mkv', { tmdbId: 1, libraryId: 'other' }));
    store.put(row('/lib/A (1999).mkv', { tmdbId: 1, kind: 'movie' }));

    expect(store.ofShow('shows', 1).map(({ path }) => path)).toEqual([
      '/lib/A/1.mkv',
      '/lib/A/2.mkv',
    ]);
  });

  /** The movies of the work tests: `title` and `path` decide the order, `tmdbId` the work. */
  const film = (path: string, title: string, tmdbId: number, extra: Partial<LibraryItem> = {}) =>
    row(path, {
      libraryId: 'films',
      kind: 'movie',
      tmdbId,
      title,
      season: null,
      episode: null,
      ...extra,
    });

  // The lead of a work is the first of its files in the order of a list: `library_works` holds it, settled by a read.
  const leadsOf = (database: Database, store: LibraryItemStore): string[] => {
    store.page('films', { limit: 1, offset: 0 });
    return database
      .prepare<[], { lead_path: string }>(
        "SELECT lead_path FROM library_works WHERE library_id = 'films' ORDER BY sort, lead_path",
      )
      .all()
      .map(({ lead_path }) => lead_path);
  };

  /** EXPLAIN needs a value for each `?`; the plan does not depend on them. */
  const placeholders = (text: string): null[] => (text.match(/\?/g) ?? []).map(() => null);

  it('reads a page, a total and the tabs without sorting the library', () => {
    const database = migrated(new Database(':memory:'));
    const store = new LibraryItemStore(database);
    store.put(film('/a.mkv', 'Alien', 1, { nfo: false }));
    const sql: string[] = [];
    const prepare = database.prepare.bind(database) as (text: string) => unknown;
    (database as unknown as { prepare: (text: string) => unknown }).prepare = (text) => {
      sql.push(text);
      return prepare(text);
    };
    store.page('films', { limit: 50, offset: 100 });
    store.page('films', { filter: 'missing-nfo', limit: 50, offset: 0 });
    store.page('films', { multi: true, limit: 50, offset: 0 });
    store.page('films', { query: 'ali', limit: 50, offset: 0 });
    store.counts('films');
    (database as unknown as { prepare: unknown }).prepare = prepare;

    const lists = sql.filter((text) => text.includes('FROM library_works'));
    // Two statements per page (total, keys); the tabs' counts are one pass over the works.
    expect(lists.filter((text) => text.includes('LIMIT'))).toHaveLength(4);
    expect(lists.filter((text) => text.includes('COUNT(*) AS total'))).toHaveLength(4 + 1);
    for (const text of lists) {
      const plan = database
        .prepare(`EXPLAIN QUERY PLAN ${text}`)
        .all(...placeholders(text))
        .map((step) => (step as { detail: string }).detail)
        .join('\n');
      expect(plan, text).not.toContain('USE TEMP B-TREE FOR ORDER BY');
    }
    const unfiltered = sql.find((text) => text.includes('ORDER BY sort ASC, lead_path ASC LIMIT'));
    expect(
      database
        .prepare(`EXPLAIN QUERY PLAN ${unfiltered ?? ''}`)
        .all(...placeholders(unfiltered ?? ''))
        .map((step) => (step as { detail: string }).detail)
        .join('\n'),
    ).toContain('library_works_sort');
  });

  it('names the first file of each work as its lead, in the order of a list', () => {
    const database = migrated(new Database(':memory:'));
    const store = new LibraryItemStore(database);
    store.put(film('/b/Zulu.mkv', 'Zulu', 1));
    store.put(film('/c/Zulu - 2160p.mkv', 'Zulu', 1));
    expect(leadsOf(database, store)).toEqual(['/b/Zulu.mkv']);

    // A second version that sorts before the first takes the lead.
    store.put(film('/a/Zulu - 1080p.mkv', 'Zulu', 1));
    expect(leadsOf(database, store)).toEqual(['/a/Zulu - 1080p.mkv']);

    // Removing the lead hands it to the next version.
    store.remove('films', '/a/Zulu - 1080p.mkv');
    expect(leadsOf(database, store)).toEqual(['/b/Zulu.mkv']);

    // A file that is moved keeps one lead per work.
    store.rename('films', '/b/Zulu.mkv', '/d/Zulu.mkv');
    expect(leadsOf(database, store)).toEqual(['/c/Zulu - 2160p.mkv']);

    // A file settled elsewhere leaves its work, and is a work of its own.
    store.put(film('/c/Zulu - 2160p.mkv', 'Alien', 2));
    expect(leadsOf(database, store)).toEqual(['/c/Zulu - 2160p.mkv', '/d/Zulu.mkv']);
    expect(store.page('films', { limit: 10, offset: 0 })).toMatchObject({
      total: 2,
      items: [{ title: 'Alien' }, { title: 'Zulu' }],
    });
  });

  it('keeps the leads right when a folder is scanned again', () => {
    const database = migrated(new Database(':memory:'));
    const store = new LibraryItemStore(database);
    store.put(film('/x/Dune.mkv', 'Dune', 3));
    store.put(film('/y/Dune - 2160p.mkv', 'Dune', 3));
    store.put(film('/y/Other.mkv', 'Other', 4));

    // Only /y was scanned: Dune's version there is gone, the one in /x leads again.
    store.replace('films', [film('/y/Other.mkv', 'Other', 4)], '/y');
    expect(leadsOf(database, store)).toEqual(['/x/Dune.mkv', '/y/Other.mkv']);

    store.replace('films', [film('/z/Dune.mkv', 'Dune', 3)]);
    expect(leadsOf(database, store)).toEqual(['/z/Dune.mkv']);
  });

  it('finds rows by the id the web uses', () => {
    const database = migrated(new Database(':memory:'));
    const store = new LibraryItemStore(database);
    for (const path of ['/lib/A/1.mkv', '/lib/A/2.mkv', '/lib/B/1.mkv']) {
      store.put(row(path));
    }
    store.put(row('/lib/A/1.mkv', { libraryId: 'other' }));

    const found = store.byItemIds('shows', [
      itemId('/lib/A/2.mkv'),
      itemId('/lib/B/1.mkv'),
      'unknown',
    ]);
    expect(found.map(({ path }) => path)).toEqual(['/lib/A/2.mkv', '/lib/B/1.mkv']);

    // A row that moved is found by its new id only.
    store.rename('shows', '/lib/B/1.mkv', '/lib/B/2.mkv');
    expect(store.byItemIds('shows', [itemId('/lib/B/1.mkv')])).toEqual([]);
    expect(store.byItemIds('shows', [itemId('/lib/B/2.mkv')])).toHaveLength(1);
  });
});

describe('the snapshot after an undo', () => {
  const row = (path: string, extra: Partial<LibraryItem> = {}): LibraryItem => ({
    libraryId: 'shows',
    path,
    kind: 'series',
    tmdbId: 1,
    title: 'Show',
    year: null,
    season: 1,
    episode: 1,
    episodeEnd: null,
    state: 'ok',
    nfo: true,
    poster: null,
    fanart: null,
    logo: null,
    thumb: null,
    entryId: null,
    scanJobId: null,
    scannedAt: '2026-11-02T00:00:00.000Z',
    unavailable: [],
    picture: null,
    ...extra,
  });
  const journal = (extra: Partial<JournalEntry> & Pick<JournalEntry, 'destination'>) =>
    ({
      id: 'j',
      batchId: 'b',
      kind: 'transfer',
      source: '/elsewhere/x.mkv',
      mode: 'copy',
      at: 'x',
      createdDirectories: [],
      ...extra,
    }) as JournalEntry;
  const setup = () => {
    const store = new LibraryItemStore(migrated(new Database(':memory:')));
    const snapshot = new LibrarySnapshot({
      config: () => ({
        libraries: [
          {
            id: 'shows',
            name: 'Shows',
            source: '/lib',
            type: 'series',
            naming: 'with-id',
            metadata: 'nfo',
          },
          { id: 'dl', name: 'Downloads', source: '/dl', into: { movie: 'shows', series: 'shows' } },
        ],
      }),
      jobs: {} as JobStore,
      entries: {} as EntryStore,
      store,
    });
    return { store, snapshot };
  };

  it('forgets a video that went back to an arrival folder', () => {
    const { store, snapshot } = setup();
    store.put(row('/lib/Show/Season 01/Show S01E01.mkv'));
    snapshot.undone([
      journal({
        source: '/dl/Show.S01E01.mkv',
        destination: '/lib/Show/Season 01/Show S01E01.mkv',
      }),
    ]);
    expect(store.all('shows')).toEqual([]);
  });

  it('moves a video renamed in place back to where it was, to rename again', () => {
    const { store, snapshot } = setup();
    store.put(row('/lib/Show/Season 01/Show S01E01.mkv'));
    snapshot.undone([
      journal({
        mode: 'move',
        source: '/lib/Show.S01E01.mkv',
        destination: '/lib/Show/Season 01/Show S01E01.mkv',
      }),
    ]);
    expect(store.all('shows').map(({ path, state }) => ({ path, state }))).toEqual([
      { path: '/lib/Show.S01E01.mkv', state: 'rename' },
    ]);
  });

  it('marks only the episode whose NFO went as lacking one', () => {
    const { store, snapshot } = setup();
    store.put(row('/lib/Show/Season 01/Show S01E01.mkv'));
    store.put(row('/lib/Show/Season 01/Show S01E02.mkv', { episode: 2 }));
    snapshot.undone([
      journal({ kind: 'generated', destination: '/lib/Show/Season 01/Show S01E02.nfo' }),
    ]);
    expect(store.all('shows').map(({ episode, nfo }) => ({ episode, nfo }))).toEqual([
      { episode: 1, nfo: true },
      { episode: 2, nfo: false },
    ]);
  });
});
