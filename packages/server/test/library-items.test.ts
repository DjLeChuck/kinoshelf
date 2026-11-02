import { rm, writeFile } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrated } from '../src/database.js';
import type { JournalEntry } from '@kinoshelf/core';
import type { EntryStore } from '../src/entries.js';
import type { JobStore } from '../src/jobs.js';
import {
  LibraryItemStore,
  LibrarySnapshot,
  itemId,
  type LibraryItem,
} from '../src/library-items.js';
import { cleanup, harness, makeDir, put } from './harness.js';

afterEach(cleanup);

const PROFILE = `
id: kodi-test
name: Kodi test
episodeRangeSeparator: '-e'
templates:
  movieFolder: '{title} ({year})'
  movieFile: '{title} ({year})'
  seriesFolder: '{title}'
  seasonFolder: 'Season {season:02}'
  episodeFile: '{title} - s{season:02}e{episode:02}'
nfo: { format: kodi, movie: movie.nfo, episode: '{file}.nfo' }
artwork: []
filesystem: { forbidden: posix, replacement: '', maxSegmentBytes: 255 }
`;

/** A movie library organized in place, holding a new film, an unknown file and a well-placed film. */
async function scanned() {
  const profile = join(await makeDir(), 'kodi.yaml');
  await writeFile(profile, PROFILE);
  const root = await makeDir();
  const dune = await put(join(root, 'Dune.2021.mkv'), 'dune');
  const mystery = await put(join(root, 'Mystery.Home.Video.mkv'));
  const alien = await put(join(root, 'Alien (1979)', 'Alien (1979).mkv'), 'alien');
  const h = await harness({
    config: {
      libraries: [
        { id: 'films', name: 'Films', source: root, type: 'movie', profile },
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
      // The profile writes an NFO and no image; nothing is there yet.
      nfo: false,
      poster: null,
      fanart: null,
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
    expect(store.get('films', moved)).toMatchObject({
      state: 'ok',
      nfo: true,
      title: 'Dune',
    });
    // Only an NFO was missing: the film stays where it is, and is now complete.
    expect(store.get('films', alien)).toMatchObject({ state: 'ok', nfo: true });

    const { batchId } = (await h.request('GET', `/api/executions/${execution.id}`)).json<{
      batchId: string;
    }>();
    expect((await h.request('POST', `/api/batches/${batchId}/undo`)).statusCode).toBe(200);

    expect(store.get('films', moved)).toBeUndefined();
    expect(store.get('films', dune)).toMatchObject({ state: 'rename', nfo: false });
    expect(store.get('films', alien)).toMatchObject({ state: 'incomplete', nfo: false });
  });

  it('follows the work a human chose for a file nobody recognized', async () => {
    const { h, store, mystery } = await scanned();
    const row = store.get('films', mystery);
    expect(row?.state).toBe('unrecognized');

    const matched = await h.request('POST', `/api/entries/${row?.entryId ?? ''}/match`, {
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
    const { batchId } = (await h.request('GET', `/api/executions/${execution.id}`)).json<{
      batchId: string;
    }>();
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
  }[];
}

describe('GET /api/libraries/:id/items', () => {
  const list = async (h: Awaited<ReturnType<typeof scanned>>['h'], query = '') =>
    (await h.request('GET', `/api/libraries/films/items${query}`)).json<ItemsBody>();

  it('lists the snapshot with its counts, by title', async () => {
    const { h, root, dune, alien } = await scanned();
    const body = await list(h);
    expect(body.library).toMatchObject({
      id: 'films',
      type: 'movie',
      path: root,
      profile: 'kodi-test',
      writes: { nfo: true, artwork: false },
    });
    expect(body.scannedAt).toEqual(expect.any(String));
    expect(body.scan).toBeNull();
    expect(body.counts).toEqual({
      all: 3,
      review: 0,
      rename: 1,
      unrecognized: 1,
      'missing-nfo': 2,
      'missing-artwork': 0,
      'missing-episodes': 0,
      'missing-show-files': 0,
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

  it('filters by state or missing file, searches, and pages', async () => {
    const { h, dune, alien } = await scanned();
    expect((await list(h, '?state=rename')).items.map((i) => i.path)).toEqual([dune]);
    expect((await list(h, '?state=missing-nfo')).items.map((i) => i.path)).toEqual([alien, dune]);
    expect((await list(h, '?state=missing-artwork')).total).toBe(0);
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
    const found = (await list(h, '?q=1080p')).items;
    expect(found.map((i) => i.resolution)).toEqual(['1080p']);
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

describe('GET /api/libraries/:id/items/:itemId', () => {
  interface ItemBody {
    id: string;
    title: string | null;
    overview: string | null;
    runtime: number | null;
    genres: string[];
    posterPath: string | null;
    file: { video: string | null; audio: string | null; size: number } | null;
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
      file: { video: 'h264', audio: 'aac 2.0', size: 4 },
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
    expect(report.items.flatMap((i) => i.results.map((r) => r.type)).sort()).toEqual([
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
    expect(store.get('films', moved)).toMatchObject({ state: 'ok', nfo: true });
    expect(store.get('films', alien)).toMatchObject({ state: 'ok', nfo: true });

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
    expect(store.get('films', alien)).toMatchObject({ state: 'ok', nfo: true });
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
    entryId: null,
    scanJobId: null,
    scannedAt: '2026-11-02T00:00:00.000Z',
    ...extra,
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
    entryId: null,
    scanJobId: null,
    scannedAt: '2026-11-02T00:00:00.000Z',
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
          { id: 'shows', name: 'Shows', source: '/lib', type: 'series', profile: 'jellyfin' },
          { id: 'dl', name: 'Downloads', source: '/dl', into: { movie: 'shows', series: 'shows' } },
        ],
      }),
      jobs: {} as JobStore,
      entries: {} as EntryStore,
      store,
    });
    return { store, snapshot };
  };

  it('forgets a video that went back to an arrival folder', async () => {
    const { store, snapshot } = setup();
    store.put(row('/lib/Show/Season 01/Show S01E01.mkv'));
    await snapshot.undone([
      journal({
        source: '/dl/Show.S01E01.mkv',
        destination: '/lib/Show/Season 01/Show S01E01.mkv',
      }),
    ]);
    expect(store.all('shows')).toEqual([]);
  });

  it('moves a video renamed in place back to where it was, to rename again', async () => {
    const { store, snapshot } = setup();
    store.put(row('/lib/Show/Season 01/Show S01E01.mkv'));
    await snapshot.undone([
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

  it('marks only the episode whose NFO went as lacking one', async () => {
    const { store, snapshot } = setup();
    store.put(row('/lib/Show/Season 01/Show S01E01.mkv'));
    store.put(row('/lib/Show/Season 01/Show S01E02.mkv', { episode: 2 }));
    await snapshot.undone([
      journal({ kind: 'generated', destination: '/lib/Show/Season 01/Show S01E02.nfo' }),
    ]);
    expect(store.all('shows').map(({ episode, nfo }) => ({ episode, nfo }))).toEqual([
      { episode: 1, nfo: true },
      { episode: 2, nfo: false },
    ]);
  });
});
