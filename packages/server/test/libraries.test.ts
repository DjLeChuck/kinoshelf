import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '@kinoshelf/core';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrated } from '../src/database.js';
import { createProcessor } from '../src/processor.js';
import { cleanup, fakeProvider, harness, makeDir, put, type Harness } from './harness.js';

afterEach(cleanup);

interface LibraryBody {
  id: string;
  name: string;
  source: string;
  destination: unknown;
  profile: string | null;
  mode: string | null;
  threshold: number | null;
  watch: boolean;
  lastScan: {
    jobId: string;
    finishedAt: string | null;
    counts: Record<string, number>;
  } | null;
  queued: number;
  scanning: boolean;
}

interface FilesBody {
  tab: string;
  total: number;
  counts: Record<string, number>;
  files: {
    id: string;
    path: string;
    classification: string;
    destination: string | null;
    score: number | null;
  }[];
}

/** A server with a real config.yaml, since libraries live there. */
async function served(yaml = '') {
  const configDir = await makeDir();
  const destination = await makeDir();
  await put(join(configDir, 'config.yaml'), `destination: ${destination}\n${yaml}`);
  const h = await harness({ configDir, config: await loadConfig(configDir) });
  const file = (): Promise<string> => readFile(join(configDir, 'config.yaml'), 'utf8');
  return { ...h, destination: h.destination, configDir, libraryDestination: destination, file };
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
    const created = await h.request('POST', '/api/libraries', { name: 'Films', source });
    const { id } = created.json<LibraryBody>();

    // What the web form sends for a library that follows the global settings.
    const patched = await h.request('PATCH', `/api/libraries/${id}`, {
      name: 'Films',
      source,
      destination: null,
      profile: null,
      mode: null,
      threshold: null,
      watch: true,
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json<LibraryBody>()).toMatchObject({ watch: true, destination: null });
  });

  it('creates, lists, changes and removes a library, in config.yaml', async () => {
    const h = await served();
    const source = await makeDir();
    expect((await h.request('GET', '/api/libraries')).json()).toEqual([]);

    const created = await h.request('POST', '/api/libraries', {
      name: 'Films 4K',
      source,
      profile: 'jellyfin',
      threshold: 80,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json<LibraryBody>()).toEqual({
      id: 'films-4k',
      name: 'Films 4K',
      source,
      destination: null,
      profile: 'jellyfin',
      mode: null,
      threshold: 80,
      watch: false,
      lastScan: null,
      queued: 0,
      scanning: false,
    });
    expect(await h.file()).toContain('id: films-4k');

    const patched = await h.request('PATCH', '/api/libraries/films-4k', {
      name: 'Films',
      profile: null,
      mode: 'hardlink',
      destination: h.libraryDestination,
    });
    expect(patched.json<LibraryBody>()).toMatchObject({
      id: 'films-4k',
      name: 'Films',
      profile: null,
      mode: 'hardlink',
      threshold: 80,
      destination: h.libraryDestination,
    });
    expect(await h.file()).not.toContain('profile: jellyfin');

    // A second library of the same name gets its own id.
    const other = await makeDir();
    const second = await h.request('POST', '/api/libraries', { name: 'Films 4K', source: other });
    expect(second.json<LibraryBody>().id).toBe('films-4k-2');

    expect((await h.request('DELETE', '/api/libraries/films-4k')).statusCode).toBe(204);
    expect(
      (await h.request('GET', '/api/libraries')).json<LibraryBody[]>().map((l) => l.id),
    ).toEqual(['films-4k-2']);
    expect((await h.request('DELETE', '/api/libraries/films-4k')).statusCode).toBe(404);
  });

  it('refuses what cannot work, with a code, and writes nothing', async () => {
    const h = await served();
    const source = await makeDir();
    const file = await put(join(source, 'a.mkv'));
    const body = (extra: object) => ({ name: 'L', source, ...extra });
    const code = async (payload: object): Promise<[number, string]> => {
      const response = await h.request('POST', '/api/libraries', payload);
      return [response.statusCode, response.json<{ error: { code: string } }>().error.code];
    };

    expect(await code(body({ source: join(source, 'missing') }))).toEqual([422, 'fs.not-found']);
    expect(await code(body({ source: file }))).toEqual([422, 'fs.not-a-directory']);
    expect(await code(body({ destination: join(source, 'missing') }))).toEqual([
      422,
      'fs.not-found',
    ]);
    expect(await code(body({ profile: 'nope' }))).toEqual([422, 'profile.unknown']);
    expect(await code(body({ source: 'relative' }))).toEqual([400, 'request.invalid']);
    expect(await code(body({ mode: 'teleport' }))).toEqual([400, 'request.invalid']);
    expect(await h.file()).not.toContain('libraries');

    await h.request('POST', '/api/libraries', body({}));
    expect(await code(body({ name: 'Other' }))).toEqual([409, 'library.source-taken']);
    const missing = await h.request('PATCH', '/api/libraries/ghost', { name: 'x' });
    expect(missing.json()).toEqual({ error: { code: 'library.not-found' } });
    const bad = await h.request('PATCH', '/api/libraries/l', { source: file });
    expect(bad.statusCode).toBe(422);
  });

  it('tells the event stream that settings changed', async () => {
    const h = await served();
    const base = await h.app.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(`${base}/api/events`, {
      headers: { authorization: `Bearer ${h.apiKey}` },
    });
    const reader = response.body?.getReader();
    await reader?.read();
    await h.request('POST', '/api/libraries', { name: 'L', source: await makeDir() });
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
    const h = await served();
    const source = await makeDir();
    const target = await makeDir();
    await put(join(source, 'Dune.2021.1080p.mkv'), 'dune');
    await put(join(source, 'Alien.1979.mkv'), 'alien');
    await put(join(source, 'Mystery.Home.Video.mkv'), 'mystery');
    await h.request('POST', '/api/libraries', {
      name: 'Films',
      source,
      destination: target,
      profile: 'jellyfin',
      mode: 'hardlink',
    });

    const jobId = await scan(h, 'films');
    const job = (await h.request('GET', `/api/jobs/${jobId}`)).json<{
      libraryId: string;
      path: string;
      settings: { profile: string; mode: string; destinationRoot: string };
    }>();
    expect(job).toMatchObject({
      libraryId: 'films',
      path: source,
      settings: { profile: 'jellyfin', mode: 'hardlink', destinationRoot: target },
    });

    const rename = (
      await h.request('GET', `/api/jobs/${jobId}/files?tab=rename`)
    ).json<FilesBody>();
    expect(rename).toMatchObject({
      tab: 'rename',
      total: 2,
      counts: { rename: 2, unrecognized: 1, ambiguous: 0, compliant: 0, renamed: 0 },
    });
    const dune = rename.files.find((f) => f.path.endsWith('Dune.2021.1080p.mkv'));
    expect(dune?.destination).toBe(
      join(target, 'Dune (2021) [tmdbid-438631]', 'Dune (2021) [tmdbid-438631].mkv'),
    );
    expect(dune?.score).toBeGreaterThan(0);

    const page = (
      await h.request('GET', `/api/jobs/${jobId}/files?tab=rename&limit=1&offset=1`)
    ).json<FilesBody>();
    expect(page.files).toHaveLength(1);
    expect(page.total).toBe(2);
    const unknown = (
      await h.request('GET', `/api/jobs/${jobId}/files?tab=unrecognized`)
    ).json<FilesBody>();
    expect(unknown.files.map((f) => f.path)).toEqual([join(source, 'Mystery.Home.Video.mkv')]);

    // The library reports the scan, and what is left to do follows the transfers.
    const [library] = (await h.request('GET', '/api/libraries')).json<LibraryBody[]>();
    expect(library?.lastScan).toMatchObject({ jobId, counts: { rename: 2, unrecognized: 1 } });

    // Only the chosen files are transferred.
    const chosen = dune?.id ?? '';
    const dry = await h.request('POST', `/api/plans/${jobId}/execute`, {
      dryRun: true,
      entries: [chosen],
    });
    expect(dry.json<{ items: unknown[] }>().items).toHaveLength(1);
    const run = await h.request('POST', `/api/plans/${jobId}/execute`, { entries: [chosen] });
    expect(run.statusCode).toBe(202);
    await h.app.jobs.idle();
    const after = (await h.request('GET', `/api/jobs/${jobId}/files?tab=rename`)).json<FilesBody>();
    expect(after.counts).toMatchObject({ rename: 1, renamed: 1 });
    expect(after.files.map((f) => f.path)).toEqual([join(source, 'Alien.1979.mkv')]);
    expect(
      await readFile(
        join(target, 'Dune (2021) [tmdbid-438631]', 'Dune (2021) [tmdbid-438631].mkv'),
        'utf8',
      ),
    ).toBe('dune');
  });

  it('organizes a library in place: source and destination are the same folder', async () => {
    const h = await served();
    const root = await makeDir();
    await put(join(root, 'Dune.2021.mkv'), 'dune');
    await put(join(root, 'Alien (1979) {tmdb-348}', 'Alien (1979) {tmdb-348}.mkv'), 'alien');
    await h.request('POST', '/api/libraries', { name: 'Home', source: root, destination: root });

    const jobId = await scan(h, 'home');
    const job = (await h.request('GET', `/api/jobs/${jobId}`)).json<{
      settings: { mode: string; profile: string };
    }>();
    expect(job.settings).toMatchObject({ mode: 'move', profile: 'plex' });
    const compliant = (
      await h.request('GET', `/api/jobs/${jobId}/files?tab=compliant`)
    ).json<FilesBody>();
    expect(compliant.files.map((f) => f.path)).toEqual([
      join(root, 'Alien (1979) {tmdb-348}', 'Alien (1979) {tmdb-348}.mkv'),
    ]);
    expect(compliant.files[0]?.destination).toBe(compliant.files[0]?.path);
    expect(compliant.counts).toMatchObject({ compliant: 1, rename: 1 });
  });

  it('refuses a second scan while one is queued or running', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const configDir = await makeDir();
    await put(join(configDir, 'config.yaml'), 'destination: /media\n');
    const h = await harness({
      configDir,
      config: await loadConfig(configDir),
      processor: async () => {
        await gate;
        return {
          analysis: {
            entries: [],
            plan: {
              id: 'p',
              createdAt: '',
              profileId: 'plex',
              destinationRoot: '/m',
              mode: 'copy',
              items: [],
            },
          },
          settings: { profile: 'plex', mode: 'copy', destinationRoot: '/m' },
        };
      },
    });
    await h.request('POST', '/api/libraries', { name: 'Films', source: await makeDir() });
    await h.request('POST', '/api/libraries', { name: 'Series', source: await makeDir() });

    const first = await h.request('POST', '/api/libraries/films/scan');
    expect(first.statusCode).toBe(202);
    const second = await h.request('POST', '/api/libraries/films/scan');
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: { code: 'library.scan-in-progress' } });
    // Another library is not blocked, and the pending state is visible.
    expect((await h.request('POST', '/api/libraries/series/scan')).statusCode).toBe(202);
    const [films] = (await h.request('GET', '/api/libraries')).json<LibraryBody[]>();
    expect(films).toMatchObject({ scanning: true, queued: 1, lastScan: null });
    // The files of a scan are not there until it is done.
    const early = await h.request(
      'GET',
      `/api/jobs/${first.json<{ id: string }>().id}/files?tab=rename`,
    );
    expect(early.statusCode).toBe(409);

    release();
    await h.app.jobs.idle();
    expect((await h.request('POST', '/api/libraries/films/scan')).statusCode).toBe(202);
    await h.app.jobs.idle();
    expect((await h.request('POST', '/api/libraries/ghost/scan')).statusCode).toBe(404);
  });

  it('falls back to the global settings when the job’s library is gone', async () => {
    const source = await makeDir();
    await put(join(source, 'Dune.2021.mkv'));
    const process = createProcessor({
      config: { destination: await makeDir(), libraries: [] },
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
      createdAt: '',
      startedAt: null,
      finishedAt: null,
      error: null,
    });
    expect(processed.settings.profile).toBe('plex');
  });

  it('answers 404 for the files of an unknown job', async () => {
    const h = await served();
    const response = await h.request(
      'GET',
      '/api/jobs/00000000-0000-4000-8000-000000000000/files?tab=rename',
    );
    expect(response.statusCode).toBe(404);
  });
});
