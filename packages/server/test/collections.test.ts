import { readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CollectionInfo, MetadataProvider, MovieDetails } from '@kinoshelf/core';
import { afterEach, describe, expect, it } from 'vitest';
import { itemId } from '../src/library-items.js';
import { cleanup, fakeProvider, harness, makeDir, put } from './harness.js';

afterEach(cleanup);

const COLLECTION = { provider: 'tmdb', id: 726871 };
const DUNE = { provider: 'tmdb', id: 438631 };

/** The fake TMDB, where Dune belongs to a saga of two films (Alien belongs to none). */
const saga: MetadataProvider = {
  ...fakeProvider,
  getMovieDetails: async (id) => {
    const details = await fakeProvider.getMovieDetails(id);
    return details && id.id === DUNE.id
      ? { ...details, collection: { id: COLLECTION, name: 'Dune - Saga' } }
      : details;
  },
  getCollection: (): Promise<CollectionInfo | null> =>
    Promise.resolve({
      id: COLLECTION,
      name: 'Dune - Saga',
      overview: 'Spice.',
      parts: [
        { id: DUNE, title: 'Dune', year: 2021 },
        { id: { provider: 'tmdb', id: 693134 }, title: 'Dune : Deuxième partie', year: 2024 },
      ],
    }),
};

interface Item {
  id: string;
  title: string;
  collection: {
    key: string;
    name: string;
    custom: boolean;
    held: number;
    total: number | null;
  } | null;
}
interface ItemsBody {
  library: { collections: boolean };
  collectionCounts: { all: number; in: number; out: number; incomplete: number };
  items: Item[];
}

async function setup(metadata: 'none' | 'nfo' = 'nfo') {
  const root = await makeDir();
  await put(join(root, 'Dune.2021.mkv'), 'dune');
  await put(join(root, 'Alien (1979)', 'Alien (1979).mkv'), 'alien');
  const h = await harness({
    createProvider: () => saga,
    // Where the NFO a change replaces is kept.
    configDir: await makeDir(),
    config: {
      libraries: [
        { id: 'films', name: 'Films', source: root, type: 'movie', naming: 'no-id', metadata },
        { id: 'shows', name: 'Shows', source: await makeDir(), type: 'series' },
      ],
    },
  });
  const scan = async () => {
    await h.request('POST', '/api/libraries/films/scan');
    await h.app.jobs.idle();
  };
  const list = async (query = '') =>
    (await h.request('GET', `/api/libraries/films/items${query}`)).json<ItemsBody>();
  await scan();
  return { h, root, scan, list };
}

/** Organizes the film, so its NFO exists and Kinoshelf wrote it. */
async function organized() {
  const ctx = await setup();
  const dune = (await ctx.list()).items.find((item) => item.title === 'Dune') as Item;
  await ctx.h.request('POST', '/api/libraries/films/execute', { items: [dune.id] });
  await ctx.h.app.jobs.idle();
  const nfo = join(ctx.root, 'Dune (2021)', 'movie.nfo');
  const choose = (choice: string, name?: string, items?: string[]) =>
    ctx.h.request('PUT', '/api/libraries/films/collection', {
      items: items ?? [itemId(join(ctx.root, 'Dune (2021)', 'Dune (2021).mkv'))],
      choice,
      ...(name !== undefined && { name }),
    });
  return { ...ctx, nfo, choose };
}

describe('the collection of a movie in the list', () => {
  it('is the one TMDB names, with how much of it the library holds', async () => {
    const { list } = await setup();
    const body = await list();
    expect(body.library.collections).toBe(true);
    const dune = body.items.find((item) => item.title === 'Dune');
    expect(dune?.collection).toEqual({
      key: `t:${String(COLLECTION.id)}`,
      name: 'Dune - Saga',
      custom: false,
      held: 1,
      total: 2,
    });
    expect(body.items.find((item) => item.title === 'Alien')?.collection).toBeNull();
    expect(body.collectionCounts).toEqual({ all: 2, in: 1, out: 1, incomplete: 1 });
  });

  it('filters by collection and orders by it, movies in none last', async () => {
    const { list } = await setup();
    expect((await list('?collection=in')).items.map((i) => i.title)).toEqual(['Dune']);
    expect((await list('?collection=out')).items.map((i) => i.title)).toEqual(['Alien']);
    expect((await list('?collection=incomplete')).items.map((i) => i.title)).toEqual(['Dune']);
    expect((await list('?collection=t:726871')).items.map((i) => i.title)).toEqual(['Dune']);
    expect((await list('?collection=t:1')).items).toEqual([]);
    expect((await list('?sort=collection')).items.map((i) => i.title)).toEqual(['Dune', 'Alien']);
    expect((await list('?sort=title')).items.map((i) => i.title)).toEqual(['Alien', 'Dune']);
    expect((await list('?sort=year')).items.map((i) => i.title)).toEqual(['Dune', 'Alien']);
  });

  it('does not exist in a library that writes no NFO', async () => {
    const { list } = await setup('none');
    const body = await list('?collection=in&sort=collection');
    expect(body.library.collections).toBe(false);
    expect(body.collectionCounts).toEqual({ all: 0, in: 0, out: 0, incomplete: 0 });
    expect(body.items.every((item) => item.collection === null)).toBe(true);
    expect(body.items).toHaveLength(2);
  });
});

describe('PUT /api/libraries/:id/collection', () => {
  it('writes the collection in the NFO a scan makes, with no action of the owner', async () => {
    const { nfo } = await organized();
    const xml = await readFile(nfo, 'utf8');
    expect(xml).toContain('<set tmdbcolid="726871">');
    expect(xml).toContain('<name>Dune - Saga</name>');
    expect(xml).toContain('<overview>Spice.</overview>');
  });

  it("files the movie under the owner's own collection, in the NFO and in the list", async () => {
    const { nfo, choose, list } = await organized();
    const answer = await choose('custom', ' Univers Arrakis ');
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toMatchObject({ movies: 1, rewritten: 1, kept: 0 });

    const xml = await readFile(nfo, 'utf8');
    expect(xml).toContain('<set>\n        <name>Univers Arrakis</name>\n    </set>');
    expect(xml).not.toContain('tmdbcolid');
    const dune = (await list()).items.find((item) => item.title === 'Dune');
    expect(dune?.collection).toMatchObject({ key: 'c:Univers Arrakis', custom: true, total: null });
    expect((await list('?collection=incomplete')).items).toEqual([]);
  });

  it('removes the movie from every collection, then brings TMDB’s back', async () => {
    const { nfo, choose, list } = await organized();
    await choose('none');
    expect(await readFile(nfo, 'utf8')).not.toContain('<set');
    expect((await list('?collection=out')).items.map((i) => i.title)).toContain('Dune');

    await choose('tmdb');
    expect(await readFile(nfo, 'utf8')).toContain('<set tmdbcolid="726871">');
    expect((await list('?collection=in')).items.map((i) => i.title)).toEqual(['Dune']);
  });

  it('survives a new scan, which reads TMDB again', async () => {
    const { choose, scan, list } = await organized();
    await choose('none');
    await scan();
    const dune = (await list()).items.find((item) => item.title === 'Dune');
    expect(dune?.collection).toBeNull();
  });

  it('is followed by an NFO written after a scan, when the first one is gone', async () => {
    const { h, nfo, choose, scan, list } = await organized();
    await choose('custom', 'Univers Arrakis');
    await rm(nfo);
    await scan();
    const dune = (await list()).items.find((item) => item.title === 'Dune') as Item;
    await h.request('POST', '/api/libraries/films/execute', { items: [dune.id] });
    await h.app.jobs.idle();
    const xml = await readFile(nfo, 'utf8');
    expect(xml).toContain('<name>Univers Arrakis</name>');
    expect(xml).not.toContain('tmdbcolid');
  });

  it('can be undone from the history', async () => {
    const { nfo, choose, h } = await organized();
    const { batchId } = (await choose('none')).json<{ batchId: string }>();
    expect(await readFile(nfo, 'utf8')).not.toContain('<set');
    const undone = await h.request('POST', `/api/batches/${batchId}/undo`, { dryRun: false });
    expect(undone.statusCode).toBe(200);
    expect(await readFile(nfo, 'utf8')).toContain('<set tmdbcolid="726871">');
  });

  it('leaves an NFO that was edited since, and says so', async () => {
    const { nfo, choose } = await organized();
    await writeFile(nfo, `${await readFile(nfo, 'utf8')}<!-- my notes -->\n`);
    await utimes(nfo, new Date(), new Date(Date.now() + 5000));

    const answer = await choose('none');
    expect(answer.json()).toMatchObject({ movies: 1, rewritten: 0, kept: 1, batchId: null });
    expect(await readFile(nfo, 'utf8')).toContain('my notes');
    expect(await readFile(nfo, 'utf8')).toContain('<set tmdbcolid="726871">');
  });

  it('refuses a custom collection with no name, and a library that writes no NFO', async () => {
    const { choose } = await organized();
    const blank = await choose('custom', '   ');
    expect(blank.statusCode).toBe(422);
    expect(blank.json<{ error: { code: string } }>().error.code).toBe('collection.name-required');

    const { h, list } = await setup('none');
    const item = (await list()).items[0] as Item;
    const refused = await h.request('PUT', '/api/libraries/films/collection', {
      items: [item.id],
      choice: 'none',
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('library.no-collections');
  });
});

describe('several movies and several versions', () => {
  it('changes the collection of a whole selection, each NFO once', async () => {
    const root = await makeDir();
    await put(join(root, 'Dune (2021)', 'Dune (2021) - 1080p.mkv'), 'a');
    await put(join(root, 'Dune (2021)', 'Dune (2021) - 2160p.mkv'), 'bb');
    await put(join(root, 'Alien (1979)', 'Alien (1979).mkv'), 'alien');
    const h = await harness({
      createProvider: () => saga,
      configDir: await makeDir(),
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
    // The two versions are one movie, filed once.
    expect(body.items).toHaveLength(2);
    expect(body.items.find((item) => item.title === 'Dune')?.collection?.held).toBe(1);

    // "Refresh" writes the missing NFO: one `movie.nfo` shared by the versions.
    await h.request('POST', '/api/libraries/films/execute', { items: body.items.map((i) => i.id) });
    await h.app.jobs.idle();
    const nfo = join(root, 'Dune (2021)', 'movie.nfo');
    expect(await readFile(nfo, 'utf8')).toContain('<set tmdbcolid="726871">');

    const answer = await h.request('PUT', '/api/libraries/films/collection', {
      items: body.items.map((i) => i.id),
      choice: 'custom',
      name: 'Films de sable',
    });
    expect(answer.json()).toMatchObject({ movies: 2, rewritten: 2, kept: 0 });
    expect(await readFile(nfo, 'utf8')).toContain('<name>Films de sable</name>');
    expect(await readFile(join(root, 'Alien (1979)', 'movie.nfo'), 'utf8')).toContain(
      '<name>Films de sable</name>',
    );
    const after = (
      await h.request('GET', '/api/libraries/films/items?sort=collection')
    ).json<ItemsBody>();
    expect(after.items.map((item) => item.collection?.held)).toEqual([2, 2]);
    expect(after.collectionCounts).toMatchObject({ in: 2, out: 0, incomplete: 0 });
  });
});

describe('the collection on the page of a movie', () => {
  it('tells TMDB’s collection, the choice, and which movies of the saga the library holds', async () => {
    const { h, root } = await organized();
    const id = itemId(join(root, 'Dune (2021)', 'Dune (2021).mkv'));
    const page = (await h.request('GET', `/api/libraries/films/items/${id}`)).json<{
      collectionChoice: {
        tmdb: { id: number; name: string } | null;
        choice: string;
        parts: { title: string; present: boolean }[];
        customNames: string[];
      } | null;
    }>();
    expect(page.collectionChoice).toMatchObject({
      tmdb: { id: 726871, name: 'Dune - Saga' },
      choice: 'tmdb',
      customNames: [],
    });
    expect(page.collectionChoice?.parts).toEqual([
      expect.objectContaining({ title: 'Dune', present: true }),
      expect.objectContaining({ title: 'Dune : Deuxième partie', present: false }),
    ]);
  });
});

// Type-only use, so the file does not import more than it needs.
export type { MovieDetails };
