import { readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig, type WatchConfig } from '@kinoshelf/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrated } from '../src/database.js';
import { FolderWatcher } from '../src/watcher.js';
import { cleanup, harness, makeDir, put } from './harness.js';

const watchers: FolderWatcher[] = [];
afterEach(async () => {
  for (const watcher of watchers.splice(0)) {
    watcher.stop();
  }
  await cleanup();
});

const NOW = Date.parse('2026-10-29T12:00:00Z');
const SETTLE = 60;

/** Sets a file's date, so a test decides how long ago it last changed. */
async function age(path: string, secondsAgo: number): Promise<void> {
  const date = new Date(NOW - secondsAgo * 1000);
  await utimes(path, date, date);
}

/** Polling mode, so no kernel watch is involved: tests call `scan` themselves. */
async function setup(options: Partial<WatchConfig> = {}) {
  const folder = await makeDir();
  const submitted: { path: string; apply: boolean }[] = [];
  const database = migrated(new Database(':memory:'));
  const watcher = new FolderWatcher({
    database,
    submit: (path, apply) => submitted.push({ path, apply }),
    log: { warn: () => undefined },
    now: () => NOW,
  });
  watchers.push(watcher);
  watcher.configure({ folders: [folder], settleSeconds: SETTLE, pollSeconds: 3600, ...options });
  await watcher.idle();
  submitted.length = 0;
  return { folder, submitted, watcher, database };
}

describe('FolderWatcher', () => {
  it('submits a release folder once, when every file has settled', async () => {
    const { folder, submitted, watcher } = await setup();
    const release = join(folder, 'Dune.2021.1080p');
    await age(await put(join(release, 'dune.mkv')), SETTLE + 1);
    await age(await put(join(release, 'extras.mkv')), 5);

    expect(await watcher.scan()).toEqual({ submitted: 0, pending: 1 });
    expect(submitted).toEqual([]);

    await age(join(release, 'extras.mkv'), SETTLE + 1);
    expect(await watcher.scan()).toEqual({ submitted: 1, pending: 0 });
    expect(submitted).toEqual([{ path: release, apply: false }]);

    await watcher.scan();
    expect(submitted).toHaveLength(1);
  });

  it('submits a file lying directly in the folder as itself', async () => {
    const { folder, submitted, watcher } = await setup({ apply: true });
    await age(await put(join(folder, 'Alien.1979.mkv')), SETTLE + 1);
    await watcher.scan();
    expect(submitted).toEqual([{ path: join(folder, 'Alien.1979.mkv'), apply: true }]);
  });

  it('waits for a client to drop its incomplete suffix, even when asked to hurry', async () => {
    const { folder, submitted, watcher } = await setup();
    const release = join(folder, 'Dune.2021');
    await age(await put(join(release, 'dune.mkv.!qB')), SETTLE + 1);
    await age(await put(join(release, 'dune.mkv')), SETTLE + 1);

    expect(await watcher.scan({ force: true })).toEqual({ submitted: 0, pending: 1 });
    await rm(join(release, 'dune.mkv.!qB'));
    expect(await watcher.scan({ force: true })).toEqual({ submitted: 1, pending: 0 });
    expect(submitted).toHaveLength(1);
  });

  it('skips the settling time when forced, for someone who knows it is done', async () => {
    const { folder, submitted, watcher } = await setup();
    await age(await put(join(folder, 'Dune.2021', 'dune.mkv')), 1);
    expect(await watcher.scan()).toEqual({ submitted: 0, pending: 1 });
    expect(await watcher.scan({ force: true })).toEqual({ submitted: 1, pending: 0 });
    expect(submitted).toHaveLength(1);
  });

  it('lets a manual scan submit a remembered file whose job is gone', async () => {
    const { folder, submitted, watcher, database } = await setup();
    const file = join(folder, 'Alien.1979.mkv');
    await age(await put(file), SETTLE + 1);
    await watcher.scan();
    expect(submitted).toHaveLength(1);

    // The job is still there: nothing to do, even when forced.
    database
      .prepare("INSERT INTO jobs (id, path, status, created_at) VALUES ('a', ?, 'done', '')")
      .run(file);
    expect(await watcher.scan({ force: true })).toEqual({ submitted: 0, pending: 0 });

    // History cleared: the file is remembered but unreachable, unless asked for.
    database.prepare('DELETE FROM jobs').run();
    expect(await watcher.scan()).toEqual({ submitted: 0, pending: 0 });
    expect(await watcher.scan({ force: true })).toEqual({ submitted: 1, pending: 0 });
    expect(submitted).toHaveLength(2);
  });

  it('submits only the new files of a release that grew', async () => {
    const { folder, submitted, watcher } = await setup();
    const release = join(folder, 'Show.S01');
    await age(await put(join(release, 'e01.mkv')), SETTLE + 1);
    await watcher.scan();
    await age(await put(join(release, 'e02.mkv')), SETTLE + 1);
    await watcher.scan();
    expect(submitted.map((s) => s.path)).toEqual([release, join(release, 'e02.mkv')]);
  });

  it('submits a replaced file again, but not one that merely stays', async () => {
    const { folder, submitted, watcher } = await setup();
    const file = join(folder, 'Dune.2021.mkv');
    await age(await put(file, 'a'), SETTLE + 1);
    await watcher.scan();
    await watcher.scan();
    await writeFile(file, 'another content');
    await age(file, SETTLE + 1);
    await watcher.scan();
    expect(submitted).toHaveLength(2);
  });

  it('forgets files that are gone, so what it remembers does not pile up', async () => {
    const { folder, watcher, database } = await setup();
    const file = join(folder, 'Dune.2021.mkv');
    await age(await put(file), SETTLE + 1);
    await watcher.scan();
    const count = () =>
      database.prepare<[], { n: number }>('SELECT count(*) AS n FROM watched_files').get()?.n;
    expect(count()).toBe(1);
    await rename(file, `${file}.moved`);
    await watcher.scan();
    expect(count()).toBe(0);
  });

  it('keeps its memory while a folder cannot be read, and says so', async () => {
    const { folder, submitted, watcher, database } = await setup();
    const file = join(folder, 'Dune.2021.mkv');
    await age(await put(file), SETTLE + 1);
    await watcher.scan();
    await rename(folder, `${folder}-away`);
    await watcher.scan();
    expect(watcher.status().folders).toEqual([{ path: folder, available: false }]);
    expect(database.prepare('SELECT 1 FROM watched_files').all()).toHaveLength(1);
    await rename(`${folder}-away`, folder);
    await watcher.scan();
    expect(submitted).toHaveLength(1);
  });

  it('ignores samples, hidden files and what is not a video', async () => {
    const { folder, watcher } = await setup();
    await age(await put(join(folder, 'Dune.2021', 'Sample', 'sample.mkv')), SETTLE + 1);
    await age(await put(join(folder, 'Dune.2021', '.hidden.mkv')), SETTLE + 1);
    await age(await put(join(folder, 'Dune.2021', 'dune.nfo')), SETTLE + 1);
    expect(await watcher.scan()).toEqual({ submitted: 0, pending: 0 });
  });

  it('submits what was there before it started', async () => {
    const folder = await makeDir();
    await age(await put(join(folder, 'Dune.2021.mkv')), SETTLE + 1);
    const submitted: string[] = [];
    const watcher = new FolderWatcher({
      database: migrated(new Database(':memory:')),
      submit: (path) => submitted.push(path),
      log: { warn: () => undefined },
      now: () => NOW,
    });
    watchers.push(watcher);
    watcher.configure({ folders: [folder], settleSeconds: SETTLE, pollSeconds: 3600 });
    await watcher.idle();
    expect(submitted).toEqual([join(folder, 'Dune.2021.mkv')]);
  });

  it('wakes on a change in the folder, with no polling', async () => {
    const folder = await makeDir();
    const submitted: string[] = [];
    const watcher = new FolderWatcher({
      database: migrated(new Database(':memory:')),
      submit: (path) => submitted.push(path),
      log: { warn: () => undefined },
    });
    watchers.push(watcher);
    watcher.configure({ folders: [folder], settleSeconds: 0 });
    expect(watcher.status().mode).toBe('events');
    await watcher.idle();
    await put(join(folder, 'Dune.2021.mkv'));
    await vi.waitFor(
      () => {
        expect(submitted).toEqual([join(folder, 'Dune.2021.mkv')]);
      },
      { timeout: 5000 },
    );
  });

  it('does nothing once configured away', async () => {
    const { folder, submitted, watcher } = await setup();
    watcher.configure(undefined);
    await age(await put(join(folder, 'Dune.2021.mkv')), SETTLE + 1);
    expect(await watcher.scan()).toEqual({ submitted: 0, pending: 0 });
    expect(submitted).toEqual([]);
    expect(watcher.status().enabled).toBe(false);
  });
});

describe('the watch API', () => {
  it('refuses a manual scan when no folder is watched', async () => {
    const h = await harness();
    const response = await h.request('POST', '/api/watch/scan');
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: 'watch.not-configured' } });
    expect((await h.request('GET', '/api/watch')).json()).toMatchObject({ enabled: false });
  });

  it('queues a job for what a manual scan finds, settled or not', async () => {
    const folder = await makeDir();
    const h = await harness({
      config: {
        destination: await makeDir(),
        watch: { folders: [folder], settleSeconds: 3600, pollSeconds: 3600 },
      },
    });
    await h.app.watcher.idle();
    await put(join(folder, 'Dune.2021.mkv'));

    const scan = await h.request('POST', '/api/watch/scan');
    expect(scan.statusCode).toBe(200);
    expect(scan.json()).toEqual({ submitted: 1, pending: 0 });
    await h.app.jobs.idle();
    const jobs = (await h.request('GET', '/api/jobs')).json<{ path: string; status: string }[]>();
    expect(jobs).toMatchObject([{ path: join(folder, 'Dune.2021.mkv'), status: 'done' }]);
  });

  it('is edited from the settings, and applied without a restart', async () => {
    const configDir = await makeDir();
    const folder = await makeDir();
    await put(join(configDir, 'config.yaml'), 'destination: /media\n');
    const h = await harness({ configDir, config: await loadConfig(configDir) });
    const patch = (payload: object) =>
      h.app.inject({
        method: 'PATCH',
        url: '/api/settings',
        headers: { authorization: `Bearer ${h.apiKey}` },
        payload,
      });

    const response = await patch({ watch: { folders: [folder], pollSeconds: 3600, apply: true } });
    expect(response.json<{ watch: unknown }>().watch).toEqual({
      folders: [folder],
      settleSeconds: null,
      pollSeconds: 3600,
      apply: true,
    });
    expect(await readFile(join(configDir, 'config.yaml'), 'utf8')).toContain('apply: true');
    expect((await h.request('GET', '/api/watch')).json()).toMatchObject({
      enabled: true,
      mode: 'poll',
      folders: [{ path: folder, available: true }],
    });

    await patch({ watch: null });
    expect((await h.request('GET', '/api/watch')).json()).toMatchObject({ enabled: false });
    expect(await readFile(join(configDir, 'config.yaml'), 'utf8')).not.toContain('watch');
  });
});
