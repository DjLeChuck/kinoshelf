import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '@kinoshelf/core';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrated } from '../src/database.js';
import { createProcessor } from '../src/processor.js';
import {
  cleanup,
  fakeProvider,
  harness,
  jobEntries,
  librariesAt,
  makeDir,
  put,
  type Harness,
} from './harness.js';

afterEach(cleanup);

interface LibraryBody {
  id: string;
  name: string;
  source: string;
  type: string | null;
  into: { movie: string; series: string } | null;
  naming: string | null;
  metadata: string | null;
  mode: string | null;
  threshold: number | null;
  watch: boolean;
  lastScan: { jobId: string; status: string } | null;
  scanning: boolean;
}

interface EntryBody {
  id: string;
  path: string;
  classification: string;
  resolution: string | null;
  destination: string | null;
  candidates: { score: number }[];
}

/** The files of a scan in one classification (what a transfer has settled is left out). */
const entriesOf = async (h: Harness, jobId: string, classification: string): Promise<EntryBody[]> =>
  Promise.resolve(
    jobEntries<EntryBody>(h, jobId).filter(
      (entry) =>
        entry.classification === classification &&
        (entry.resolution === null || entry.resolution === 'failed'),
    ),
  );

/** A server with a real config.yaml, since libraries live there. */
async function served(yaml = '') {
  const configDir = await makeDir();
  await put(join(configDir, 'config.yaml'), yaml);
  const h = await harness({ configDir, config: await loadConfig(configDir) });
  const file = (): Promise<string> => readFile(join(configDir, 'config.yaml'), 'utf8');
  return { ...h, configDir, file };
}

/** A movie library and a series library, the destinations an arrival folder points at. */
async function typedLibraries(h: Harness): Promise<{ movies: string; series: string }> {
  const movies = await makeDir();
  const series = await makeDir();
  await h.request('POST', '/api/libraries', { name: 'Films', source: movies, type: 'movie' });
  await h.request('POST', '/api/libraries', { name: 'Series', source: series, type: 'series' });
  return { movies, series };
}

const scan = async (h: Harness, id: string): Promise<string> => {
  const response = await h.request('POST', `/api/libraries/${id}/scan`);
  expect(response.statusCode).toBe(202);
  await h.app.jobs.idle();
  return response.json<{ id: string }>().id;
};

describe('libraries', () => {
  it('accepts the form of an edit that only turns watching on: every unset field is null', async () => {
    const h = await served();
    const source = await makeDir();
    const created = await h.request('POST', '/api/libraries', {
      name: 'Films',
      source,
      type: 'movie',
    });
    const { id } = created.json<LibraryBody>();

    // What the web form sends for a library that follows the global settings.
    const patched = await h.request('PATCH', `/api/libraries/${id}`, {
      name: 'Films',
      source,
      into: null,
      naming: null,
      metadata: null,
      mode: null,
      threshold: null,
      watch: true,
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json<LibraryBody>()).toMatchObject({ watch: true, type: 'movie', into: null });
  });

  it('creates, lists, changes and removes a library, in config.yaml', async () => {
    const h = await served();
    const source = await makeDir();
    expect((await h.request('GET', '/api/libraries')).json()).toEqual([]);

    const created = await h.request('POST', '/api/libraries', {
      name: 'Films 4K',
      source,
      type: 'movie',
      naming: 'no-id',
      metadata: 'nfo',
      threshold: 80,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json<LibraryBody>()).toEqual({
      id: 'films-4k',
      name: 'Films 4K',
      source,
      type: 'movie',
      into: null,
      naming: 'no-id',
      metadata: 'nfo',
      mode: null,
      threshold: 80,
      watch: false,
      lastScan: null,
      scanning: false,
    });
    expect(await h.file()).toContain('id: films-4k');

    const patched = await h.request('PATCH', '/api/libraries/films-4k', {
      name: 'Films',
      naming: null,
      threshold: 90,
    });
    expect(patched.json<LibraryBody>()).toMatchObject({
      id: 'films-4k',
      name: 'Films',
      type: 'movie',
      naming: null,
      threshold: 90,
    });
    expect(await h.file()).not.toContain('naming:');
    expect(await h.file()).toContain('metadata: nfo');

    // A second library of the same name gets its own id.
    const other = await makeDir();
    const second = await h.request('POST', '/api/libraries', {
      name: 'Films 4K',
      source: other,
      type: 'series',
    });
    expect(second.json<LibraryBody>().id).toBe('films-4k-2');

    expect((await h.request('DELETE', '/api/libraries/films-4k')).statusCode).toBe(204);
    expect(
      (await h.request('GET', '/api/libraries')).json<LibraryBody[]>().map((l) => l.id),
    ).toEqual(['films-4k-2']);
    expect((await h.request('DELETE', '/api/libraries/films-4k')).statusCode).toBe(404);
  });

  it('starts empty when made again under the same name, or pointed at another folder', async () => {
    const h = await served();
    const first = await makeDir();
    await put(join(first, 'Dune.2021.mkv'));
    const create = () =>
      h.request('POST', '/api/libraries', { name: 'Films', source: first, type: 'movie' });
    const total = async (): Promise<number> =>
      (await h.request('GET', '/api/libraries/films/items')).json<{ total: number }>().total;

    await create();
    await scan(h, 'films');
    expect(await total()).toBe(1);
    expect((await h.request('DELETE', '/api/libraries/films')).statusCode).toBe(204);
    await create();
    expect(await total()).toBe(0);

    await scan(h, 'films');
    expect(await total()).toBe(1);
    const moved = await h.request('PATCH', '/api/libraries/films', { source: await makeDir() });
    expect(moved.statusCode).toBe(200);
    expect(await total()).toBe(0);
  });

  it('refuses a system folder as a source', async () => {
    const h = await served();
    const created = await h.request('POST', '/api/libraries', {
      name: 'Kernel',
      source: '/sys',
      type: 'movie',
    });
    expect(created.statusCode).toBe(422);
    expect(created.json()).toEqual({
      error: { code: 'fs.system-folder', params: { path: '/sys' } },
    });
  });

  it('refuses what cannot work, with a code, and writes nothing', async () => {
    const h = await served();
    const source = await makeDir();
    const file = await put(join(source, 'a.mkv'));
    const body = (extra: object) => ({ name: 'L', source, type: 'movie', ...extra });
    const code = async (payload: object): Promise<[number, string]> => {
      const response = await h.request('POST', '/api/libraries', payload);
      return [response.statusCode, response.json<{ error: { code: string } }>().error.code];
    };

    expect(await code(body({ source: join(source, 'missing') }))).toEqual([422, 'fs.not-found']);
    expect(await code(body({ source: file }))).toEqual([422, 'fs.not-a-directory']);
    expect(await code(body({ naming: 'nope' }))).toEqual([400, 'request.invalid']);
    expect(await code(body({ source: 'relative' }))).toEqual([400, 'request.invalid']);
    expect(await code(body({ mode: 'teleport' }))).toEqual([400, 'request.invalid']);
    // A library is a typed one or an arrival folder, never both nor neither, and `into` must name
    // libraries of the right type: the config refuses, and nothing is written.
    expect(await code({ name: 'L', source })).toEqual([422, 'library.invalid']);
    expect(await code(body({ into: { movie: 'a', series: 'b' } }))).toEqual([
      422,
      'library.invalid',
    ]);
    expect(await code(body({ mode: 'copy' }))).toEqual([422, 'library.invalid']);
    expect(await code({ name: 'L', source, into: { movie: 'nope', series: 'nope' } })).toEqual([
      422,
      'library.invalid',
    ]);
    expect(await h.file()).not.toContain('libraries');

    await h.request('POST', '/api/libraries', body({}));
    expect(await code(body({ name: 'Other' }))).toEqual([409, 'library.source-taken']);
    const missing = await h.request('PATCH', '/api/libraries/ghost', { name: 'x' });
    expect(missing.json()).toEqual({ error: { code: 'library.not-found' } });
    const bad = await h.request('PATCH', '/api/libraries/l', { source: file });
    expect(bad.statusCode).toBe(422);
  });

  it('keeps a library an arrival folder points at', async () => {
    const h = await served();
    await typedLibraries(h);
    const arrival = await h.request('POST', '/api/libraries', {
      name: 'Downloads',
      source: await makeDir(),
      into: { movie: 'films', series: 'series' },
      mode: 'hardlink',
    });
    expect(arrival.statusCode, arrival.body).toBe(201);
    expect(arrival.json<LibraryBody>()).toMatchObject({
      type: null,
      into: { movie: 'films', series: 'series' },
      mode: 'hardlink',
    });

    const refused = await h.request('DELETE', '/api/libraries/films');
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({
      error: { code: 'library.in-use', params: { name: 'Downloads' } },
    });
    expect((await h.request('DELETE', '/api/libraries/downloads')).statusCode).toBe(204);
    expect((await h.request('DELETE', '/api/libraries/films')).statusCode).toBe(204);
  });

  it('tells the event stream that settings changed', async () => {
    const h = await served();
    const base = await h.app.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(`${base}/api/events`, {
      headers: { authorization: `Bearer ${h.apiKey}` },
    });
    const reader = response.body?.getReader();
    await reader?.read();
    await h.request('POST', '/api/libraries', {
      name: 'L',
      source: await makeDir(),
      type: 'movie',
    });
    const chunk = await reader?.read();
    await reader?.cancel();
    expect(new TextDecoder().decode(chunk?.value as Uint8Array)).toContain('event: settings');
  });

  it('requires authentication', async () => {
    const h = await served();
    const response = await h.app.inject({ method: 'GET', url: '/api/libraries' });
    expect(response.statusCode).toBe(401);
  });
});

describe('scanning a library', () => {
  it('scans its source with its own settings and sorts the files in tabs', async () => {
    const h = await served('metadata: nfo\n');
    const source = await makeDir();
    const { movies: target, series } = await typedLibraries(h);
    await put(join(source, 'Dune.2021.mkv'), 'dune');
    await put(join(source, 'Alien.1979.mkv'), 'alien');
    await put(join(source, 'Mystery.Home.Video.mkv'), 'mystery');
    // An arrival folder: its files go to the typed libraries, with its own mode.
    await h.request('POST', '/api/libraries', {
      name: 'Downloads',
      source,
      into: { movie: 'films', series: 'series' },
      mode: 'hardlink',
    });

    const jobId = await scan(h, 'downloads');
    const job = (await h.request('GET', `/api/jobs/${jobId}`)).json<{
      libraryId: string;
      path: string;
      settings: { profile: unknown; mode: string; destinationRoot: unknown };
    }>();
    expect(job).toMatchObject({
      libraryId: 'downloads',
      path: source,
      settings: {
        profile: { naming: 'with-id', metadata: 'nfo' },
        mode: 'hardlink',
        destinationRoot: { movie: target, series },
      },
    });

    const rename = await entriesOf(h, jobId, 'to-rename');
    expect(rename).toHaveLength(2);
    const dune = rename.find((f) => f.path.endsWith('Dune.2021.mkv'));
    expect(dune?.destination).toBe(
      join(target, 'Dune (2021) {tmdb-438631}', 'Dune (2021) {tmdb-438631}.mkv'),
    );
    expect(dune?.candidates[0]?.score).toBeGreaterThan(0);

    const unknown = await entriesOf(h, jobId, 'unrecognized');
    expect(unknown.map((f) => f.path)).toEqual([join(source, 'Mystery.Home.Video.mkv')]);

    // The library reports the scan.
    const library = (await h.request('GET', '/api/libraries'))
      .json<LibraryBody[]>()
      .find((l) => l.id === 'downloads');
    expect(library?.lastScan).toEqual({ jobId, status: 'done' });

    // Only the chosen files are transferred.
    const chosen = dune?.id ?? '';
    const run = await h.request('POST', `/api/plans/${jobId}/execute`, { entries: [chosen] });
    expect(run.statusCode).toBe(202);
    await h.app.jobs.idle();
    expect((await entriesOf(h, jobId, 'to-rename')).map((f) => f.path)).toEqual([
      join(source, 'Alien.1979.mkv'),
    ]);
    expect(
      await readFile(
        join(target, 'Dune (2021) {tmdb-438631}', 'Dune (2021) {tmdb-438631}.mkv'),
        'utf8',
      ),
    ).toBe('dune');
  });

  it('organizes a library in place: source and destination are the same folder', async () => {
    const h = await served();
    const root = await makeDir();
    await put(join(root, 'Dune.2021.mkv'), 'dune');
    await put(join(root, 'Alien (1979) {tmdb-348}', 'Alien (1979) {tmdb-348}.mkv'), 'alien');
    await h.request('POST', '/api/libraries', {
      name: 'Home',
      source: root,
      type: 'movie',
    });

    const jobId = await scan(h, 'home');
    const job = (await h.request('GET', `/api/jobs/${jobId}`)).json<{
      settings: { mode: string; profile: unknown };
    }>();
    expect(job.settings).toMatchObject({
      mode: 'move',
      profile: { naming: 'with-id', metadata: 'none' },
    });
    const compliant = await entriesOf(h, jobId, 'compliant');
    expect(compliant.map((f) => f.path)).toEqual([
      join(root, 'Alien (1979) {tmdb-348}', 'Alien (1979) {tmdb-348}.mkv'),
    ]);
  });

  it('refuses a second scan while one is queued or running', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const configDir = await makeDir();
    const h = await harness({
      configDir,
      config: {},
      processor: async () => {
        await gate;
        return {
          analysis: {
            entries: [],
            plan: {
              id: 'p',
              createdAt: '',
              profileId: 'with-id.none',
              destinationRoot: '/m',
              mode: 'copy',
              items: [],
            },
          },
          settings: {
            profile: { naming: 'with-id', metadata: 'none' },
            mode: 'copy',
            destinationRoot: '/m',
          },
        };
      },
    });
    await h.request('POST', '/api/libraries', {
      name: 'Films',
      source: await makeDir(),
      type: 'movie',
    });
    await h.request('POST', '/api/libraries', {
      name: 'Series',
      source: await makeDir(),
      type: 'series',
    });

    const first = await h.request('POST', '/api/libraries/films/scan');
    expect(first.statusCode).toBe(202);
    const second = await h.request('POST', '/api/libraries/films/scan');
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: { code: 'library.scan-in-progress' } });
    // Another library is not blocked, and the pending state is visible.
    expect((await h.request('POST', '/api/libraries/series/scan')).statusCode).toBe(202);
    const [films] = (await h.request('GET', '/api/libraries')).json<LibraryBody[]>();
    expect(films).toMatchObject({
      scanning: true,
      lastScan: { status: expect.stringMatching(/^(queued|running)$/) as string },
    });

    release();
    await h.app.jobs.idle();
    expect((await h.request('POST', '/api/libraries/films/scan')).statusCode).toBe(202);
    await h.app.jobs.idle();
    expect((await h.request('POST', '/api/libraries/ghost/scan')).statusCode).toBe(404);
  });

  it('scans one folder again: only the rows under it are replaced', async () => {
    const h = await served();
    const root = await makeDir();
    const alien = join(root, 'Alien (1979) {tmdb-348}');
    const dune = join(root, 'Dune (2021) {tmdb-438631}');
    await put(join(alien, 'Alien (1979) {tmdb-348}.mkv'), 'alien');
    await put(join(dune, 'Dune (2021) {tmdb-438631}.mkv'), 'dune');
    await h.request('POST', '/api/libraries', { name: 'Home', source: root, type: 'movie' });
    await scan(h, 'home');
    const titles = async (): Promise<string[]> =>
      (await h.request('GET', '/api/libraries/home/items'))
        .json<{ items: { title: string }[] }>()
        .items.map((item) => item.title)
        .sort();
    expect(await titles()).toEqual(['Alien', 'Dune']);

    // Dune is gone from the disk, but only Alien's folder is read again: Dune's row stays.
    await rm(dune, { recursive: true });
    const again = await h.request('POST', '/api/libraries/home/rescan', { path: alien });
    expect(again.statusCode).toBe(202);
    await h.app.jobs.idle();
    expect(await titles()).toEqual(['Alien', 'Dune']);

    // Read on its own, the emptied folder loses its rows.
    await put(join(dune, 'notes.txt'), 'x');
    expect((await h.request('POST', '/api/libraries/home/rescan', { path: dune })).statusCode).toBe(
      202,
    );
    await h.app.jobs.idle();
    expect(await titles()).toEqual(['Alien']);
  });

  it('refuses to scan again what is not strictly inside the library', async () => {
    const h = await served();
    const root = await makeDir();
    await put(join(root, 'Alien (1979) {tmdb-348}', 'Alien (1979) {tmdb-348}.mkv'), 'alien');
    await h.request('POST', '/api/libraries', { name: 'Home', source: root, type: 'movie' });
    const code = async (path: string): Promise<[number, string]> => {
      const response = await h.request('POST', '/api/libraries/home/rescan', { path });
      return [response.statusCode, response.json<{ error: { code: string } }>().error.code];
    };
    expect(await code(root)).toEqual([422, 'library.outside']);
    expect(await code(`${root}2`)).toEqual([422, 'library.outside']);
    expect(await code(await makeDir())).toEqual([422, 'library.outside']);
    expect(await code(join(root, 'Gone'))).toEqual([422, 'fs.not-found']);
  });

  it('refuses a scan of one folder while a scan of the library is queued', async () => {
    const h = await served();
    const root = await makeDir();
    const alien = join(root, 'Alien (1979) {tmdb-348}');
    await put(join(alien, 'Alien (1979) {tmdb-348}.mkv'), 'alien');
    await h.request('POST', '/api/libraries', { name: 'Home', source: root, type: 'movie' });
    expect((await h.request('POST', '/api/libraries/home/scan')).statusCode).toBe(202);
    const refused = await h.request('POST', '/api/libraries/home/rescan', { path: alien });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: { code: 'library.scan-in-progress' } });
    await h.app.jobs.idle();
  });

  it('falls back to the global settings when the job’s library is gone', async () => {
    const source = await makeDir();
    await put(join(source, 'Dune.2021.mkv'));
    const process = createProcessor({
      config: { libraries: [...librariesAt(await makeDir())] },
      configDir: '/nonexistent',
      database: migrated(new Database(':memory:')),
      env: {},
      createProvider: () => fakeProvider,
    });
    const processed = await process({
      id: 'j',
      path: source,
      libraryId: 'removed',
      status: 'running',
      apply: false,
      rescan: false,
      createdAt: '',
      startedAt: null,
      finishedAt: null,
      error: null,
    });
    expect(processed.settings.profile).toEqual({ naming: 'with-id', metadata: 'none' });
  });
});
