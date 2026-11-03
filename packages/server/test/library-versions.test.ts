import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { itemId, LibraryItemStore } from '../src/library-items.js';
import { cleanup, harness, makeDir, put } from './harness.js';

afterEach(cleanup);

const FOLDER = 'Dune (2021) {tmdb-438631}';

/** A movie library already holding one film in its folder, under the file name given. */
async function organized(fileName: string) {
  const root = await makeDir();
  const file = await put(join(root, FOLDER, fileName), 'dune');
  const h = await harness({
    config: {
      libraries: [{ id: 'films', name: 'Films', source: root, type: 'movie', profile: 'plex' }],
    },
  });
  await h.request('POST', '/api/libraries/films/scan');
  await h.app.jobs.idle();
  return { h, root, file, store: new LibraryItemStore(h.database) };
}

type Organized = Awaited<ReturnType<typeof organized>>;
const execute = (h: Organized['h'], items: string[], dryRun = false, screenSize?: string) =>
  h.request('POST', '/api/libraries/films/execute', {
    items,
    version: true,
    dryRun,
    ...(screenSize !== undefined && { screenSize }),
  });
const folderOf = (root: string) => readdir(join(root, FOLDER));

describe('POST /api/libraries/:id/execute with version', () => {
  it('previews, then names the version of a film already in its folder', async () => {
    const { h, root, file, store } = await organized(`${FOLDER} [1080p].mkv`);
    // The name is right enough for the scan: nothing to rename without being asked.
    expect(store.get('films', file)?.state).toBe('ok');

    const preview = await execute(h, [itemId(file)], true);
    expect(preview.statusCode).toBe(200);
    expect(
      preview
        .json<{ items: { results: { mode: string | null; destination: string }[] }[] }>()
        .items.flatMap((i) => i.results.map((r) => [r.mode, r.destination])),
    ).toEqual([['move', join(root, FOLDER, `${FOLDER} - 1080p.mkv`)]]);
    expect(await folderOf(root)).toEqual([`${FOLDER} [1080p].mkv`]);

    const run = await execute(h, [itemId(file)]);
    expect(run.statusCode).toBe(202);
    await h.app.jobs.idle();
    expect(await folderOf(root)).toEqual([`${FOLDER} - 1080p.mkv`]);
    expect(store.get('films', join(root, FOLDER, `${FOLDER} - 1080p.mkv`))).toMatchObject({
      state: 'ok',
    });

    // One batch, which can be undone like any other.
    const history = (await h.request('GET', '/api/history')).json<{
      items: { kind: string; id: string }[];
    }>();
    expect(history.items).toHaveLength(1);
    const undo = await h.request('POST', `/api/batches/${history.items[0]?.id}/undo`, {});
    expect(undo.statusCode).toBe(200);
    expect(await folderOf(root)).toEqual([`${FOLDER} [1080p].mkv`]);
  });

  it('refuses a film whose name says no size, and says why', async () => {
    const { h, file } = await organized(`${FOLDER}.mkv`);
    const response = await execute(h, [itemId(file)], true);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: 'library.version-unavailable' } });
  });

  it('has nothing to do for a film that already carries its version', async () => {
    const { h, file } = await organized(`${FOLDER} - 1080p.mkv`);
    const response = await execute(h, [itemId(file)], true);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: 'library.nothing-to-do' } });
  });
});

describe('a size chosen by hand', () => {
  it('names the version of a film whose file name says none', async () => {
    const { h, root, file } = await organized(`${FOLDER}.mkv`);
    expect((await execute(h, [itemId(file)], true)).statusCode).toBe(409);

    const preview = await execute(h, [itemId(file)], true, '2160p');
    expect(preview.statusCode).toBe(200);
    expect(await folderOf(root)).toEqual([`${FOLDER}.mkv`]);

    expect((await execute(h, [itemId(file)], false, '2160p')).statusCode).toBe(202);
    await h.app.jobs.idle();
    expect(await folderOf(root)).toEqual([`${FOLDER} - 2160p.mkv`]);
  });

  it('wins over the size the name says', async () => {
    const { h, root, file } = await organized(`${FOLDER} [1080p].mkv`);
    await execute(h, [itemId(file)], false, '720p');
    await h.app.jobs.idle();
    expect(await folderOf(root)).toEqual([`${FOLDER} - 720p.mkv`]);
  });

  it('refuses something that is not a size', async () => {
    const { h, file } = await organized(`${FOLDER}.mkv`);
    expect((await execute(h, [itemId(file)], true, 'big')).statusCode).toBe(400);
  });
});

describe('a library holding two versions of one movie', () => {
  it('lists one row per file, both in order, each with its own size', async () => {
    const { h, root } = await organized(`${FOLDER} - 1080p.mkv`);
    await put(join(root, FOLDER, `${FOLDER} - 2160p.mkv`), 'dune in 4k');
    await h.request('POST', '/api/libraries/films/scan');
    await h.app.jobs.idle();

    const page = (await h.request('GET', '/api/libraries/films/items')).json<{
      total: number;
      items: { id: string; state: string; resolution: string | null; tmdbId: number }[];
    }>();

    expect(page.total).toBe(2);
    expect(page.items.map((item) => [item.state, item.resolution, item.tmdbId]).sort()).toEqual([
      ['ok', '1080p', 438631],
      ['ok', '2160p', 438631],
    ]);
    expect(new Set(page.items.map(({ id }) => id)).size).toBe(2);
    expect(await readdir(join(root, FOLDER))).toHaveLength(2);
  });
});
