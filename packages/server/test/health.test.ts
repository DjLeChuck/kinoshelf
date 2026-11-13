import { rm } from 'node:fs/promises';
import { Database, type Config } from '@kinoshelf/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Health } from '../src/health.js';
import type { PlexSession } from '../src/plex-session.js';
import type { FolderWatcher, WatchStatus } from '../src/watcher.js';
import { cleanup, harness, librariesAt, makeDir } from './harness.js';

afterEach(cleanup);

const watching = (status: Partial<WatchStatus> = {}) =>
  ({
    status: () => ({
      enabled: false,
      mode: 'events',
      folders: [],
      pending: 0,
      lastScanAt: null,
      nextScanAt: null,
      intervalSeconds: null,
      ...status,
    }),
  }) as unknown as FolderWatcher;

const plex = (error: boolean) =>
  ({ account: { connected: true, error } }) as unknown as PlexSession;

async function setup(
  options: { config?: Config; watcher?: FolderWatcher; plexError?: boolean } = {},
) {
  const source = await makeDir();
  const changed = vi.fn();
  const config: Config = options.config ?? {
    libraries: [{ id: 'films', name: 'Films', source, type: 'movie' }],
  };
  const health = new Health({
    database: new Database(':memory:'),
    config: () => config,
    watcher: options.watcher ?? watching(),
    plexSession: plex(options.plexError === true),
    changed,
  });
  return { health, changed, source };
}

describe('Health', () => {
  it('has nothing to report when everything is where it should be', async () => {
    const { health } = await setup();
    expect(await health.problems()).toEqual([]);
  });

  it('reports a library whose folder is gone, with its name and path', async () => {
    const { health, source } = await setup();
    await rm(source, { recursive: true });
    expect(await health.problems()).toEqual([
      {
        area: 'libraries',
        code: 'library-unreachable',
        params: { name: 'Films', path: source },
      },
    ]);
  });

  it('reports a watched folder the watcher cannot read, once it has looked', async () => {
    const folder = { path: '/mnt/gone', libraryId: null, available: false };
    const before = await setup({ watcher: watching({ folders: [folder] }) });
    expect(await before.health.problems()).toEqual([]);

    const after = await setup({
      watcher: watching({ folders: [folder], lastScanAt: '2026-11-13T10:00:00.000Z' }),
    });
    expect(await after.health.problems()).toMatchObject([
      { area: 'watch', code: 'watch-folder-unreachable', params: { path: '/mnt/gone' } },
    ]);
  });

  it('reports a Plex sign-in plex.tv refused, only when Plex is a target', async () => {
    const source = await makeDir();
    const libraries: Config['libraries'] = [{ id: 'films', name: 'Films', source, type: 'movie' }];
    const used = await setup({
      config: { libraries, notify: { plex: { url: 'http://plex:32400' } } },
      plexError: true,
    });
    expect(await used.health.problems()).toEqual([{ area: 'media', code: 'plex-signed-out' }]);

    const unused = await setup({ config: { libraries }, plexError: true });
    expect(await unused.health.problems()).toEqual([]);
  });

  it('tells the clients only when the number of errors changes', async () => {
    const { health, changed, source } = await setup();
    expect(await health.check()).toBe(0);
    // The first reading is not a change: a client reads it when it connects.
    expect(changed).not.toHaveBeenCalled();

    await health.check();
    expect(changed).not.toHaveBeenCalled();

    await rm(source, { recursive: true });
    expect(await health.check()).toBe(1);
    expect(changed).toHaveBeenCalledTimes(1);
    await health.check();
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/health', () => {
  it('counts the errors, and needs the key', async () => {
    const h = await harness({ config: { libraries: [...librariesAt(await makeDir())] } });
    expect((await h.request('GET', '/api/health')).json()).toEqual({ errors: 0 });

    const anonymous = await h.app.inject({ method: 'GET', url: '/api/health' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('turns to one when a library folder disappears', async () => {
    const source = await makeDir();
    const h = await harness({ config: { libraries: [...librariesAt(source)] } });
    await rm(source, { recursive: true });
    const { errors } = (await h.request('GET', '/api/health')).json<{ errors: number }>();
    expect(errors).toBeGreaterThan(0);
  });
});
