import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NotifyConfig } from '@kinoshelf/core';
import type { Execution } from '../src/executions.js';
import type { Job } from '../src/jobs.js';
import { Notifier } from '../src/notify/notifier.js';
import { closeFakeServers, fakeServer, type Received } from './fake-server.js';
import { cleanup, harness, makeDir, put, type Harness } from './harness.js';

afterEach(async () => {
  await cleanup();
  await closeFakeServers();
});

const SECTIONS_XML = readFileSync(
  join(import.meta.dirname, 'fixtures', 'plex-sections.xml'),
  'utf8',
);
const instant = { sleep: () => Promise.resolve(), delays: [] as number[] };

interface Payload {
  event: string;
  reason?: string;
  title: string;
  message: string;
  priority?: number;
  job?: { id: string; path: string };
  execution?: { id: string; batchId: string | null; done: number; failed: number };
  files: { status: string; destination: string | null; error?: { code: string } }[];
  error?: { code: string; params?: Record<string, string> };
  review?: { ambiguous: number; unrecognized: number; conflict: number };
  Updates?: { Path: string; UpdateType: string }[];
}

const json = (received: Received): Payload => JSON.parse(received.body) as Payload;

/** An app that reports to a webhook, Plex and Jellyfin, which are three real local servers. */
async function reporting(
  options: { locale?: 'en' | 'fr'; webhooks?: NotifyConfig['webhooks'] } = {},
) {
  const hook = await fakeServer();
  const plex = await fakeServer((r) =>
    r.url === '/library/sections' ? { body: SECTIONS_XML } : {},
  );
  const jellyfin = await fakeServer(() => ({ status: 204 }));
  const destination = await makeDir();
  const h = await harness({
    config: {
      destination,
      ...(options.locale && { locale: options.locale }),
      apiKey: { plex: 'PTOKEN', jellyfin: 'JKEY' },
      notify: {
        webhooks: options.webhooks ?? [
          { url: `${hook.url}/generic` },
          { url: `${hook.url}/gotify`, format: 'gotify', on: ['failed'] },
        ],
        plex: { url: plex.url, paths: [{ from: destination, to: '/mnt/videos/movies' }] },
        jellyfin: { url: jellyfin.url, paths: [{ from: destination, to: '/data/movies' }] },
      },
    },
    delivery: instant,
  });
  return { h, hook, plex, jellyfin, destination };
}

/** Submits a folder and waits until everything, notifications included, has settled. */
async function apply(h: Harness, files: Record<string, string>): Promise<string> {
  const source = await makeDir();
  for (const [name, content] of Object.entries(files)) {
    await put(join(source, name), content);
  }
  const job = (await h.request('POST', '/api/jobs', { path: source, apply: true })).json<{
    id: string;
  }>();
  await h.app.jobs.idle();
  await h.app.notifier.idle();
  return job.id;
}

const movieFolder = (destination: string, name: string) => join(destination, name);
const plexRefreshes = (plex: { received: Received[] }) =>
  plex.received.filter((r) => r.url.includes('/refresh'));

describe('after a transfer', () => {
  it('tells the webhooks that listen, and asks Plex and Jellyfin to look at the new folder', async () => {
    const { h, hook, plex, jellyfin } = await reporting();

    await apply(h, { 'Dune.2021.1080p.mkv': 'dune' });

    // The generic webhook listens to the default events; the Gotify one only to failures.
    expect(hook.received.map((r) => r.url)).toEqual(['/generic']);
    const message = json(hook.received[0] as Received);
    expect(message).toMatchObject({
      event: 'transferred',
      title: '1 file(s) transferred',
      execution: { done: 1, failed: 0 },
      files: [{ status: 'done' }],
    });
    expect(message.files[0]?.destination).toContain('Dune (2021) {tmdb-438631}');

    const refreshes = plexRefreshes(plex);
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]?.url).toBe(
      `/library/sections/3/refresh?path=${encodeURIComponent('/mnt/videos/movies/Dune (2021) {tmdb-438631}')}`,
    );
    expect(refreshes[0]?.headers['x-plex-token']).toBe('PTOKEN');

    expect(jellyfin.received).toHaveLength(1);
    expect(jellyfin.received[0]).toMatchObject({ method: 'POST', url: '/Library/Media/Updated' });
    expect(jellyfin.received[0]?.headers.authorization).toBe('MediaBrowser Token="JKEY"');
    expect(json(jellyfin.received[0] as Received).Updates).toEqual([
      { Path: '/data/movies/Dune (2021) {tmdb-438631}', UpdateType: 'Created' },
    ]);
  });

  it('speaks the language of the configuration', async () => {
    const { h, hook } = await reporting({ locale: 'fr' });
    await apply(h, { 'Dune.2021.1080p.mkv': 'dune' });
    expect(json(hook.received[0] as Received).title).toBe('1 fichier(s) transféré(s)');
  });

  it('is a failure when a file did not go through, yet still refreshes what did', async () => {
    const { h, hook, plex, destination } = await reporting();
    const source = await makeDir();
    await put(join(source, 'Dune.2021.1080p.mkv'), 'dune');
    await put(join(source, 'Alien.1979.1080p.mkv'), 'alien');
    const job = (await h.request('POST', '/api/jobs', { path: source })).json<{ id: string }>();
    await h.app.jobs.idle();

    // Something takes Alien's place after the analysis: it is never overwritten.
    await put(
      join(movieFolder(destination, 'Alien (1979) {tmdb-348}'), 'Alien (1979) {tmdb-348}.mkv'),
      'taken',
    );
    await h.request('POST', `/api/plans/${job.id}/execute`);
    await h.app.jobs.idle();
    await h.app.notifier.idle();

    // Both webhooks hear a failure: the generic one by default, the Gotify one because it asked.
    expect(hook.received.map((r) => r.url).sort()).toEqual(['/generic', '/gotify']);
    const generic = json(hook.received.find((r) => r.url === '/generic') as Received);
    expect(generic).toMatchObject({
      event: 'failed',
      reason: 'files',
      title: '1 file(s) not transferred',
      execution: { done: 1, failed: 1 },
    });
    expect(generic.message).toContain('Alien.1979.1080p.mkv: A file already exists at');
    expect(generic.files.map((f) => f.status).sort()).toEqual(['done', 'failed']);
    expect(generic.files.find((f) => f.status === 'failed')?.error?.code).toBe(
      'destination.exists',
    );

    expect(json(hook.received.find((r) => r.url === '/gotify') as Received).priority).toBe(8);
    expect(plexRefreshes(plex)).toHaveLength(1); // Dune's folder, not Alien's
  });

  it('does not refresh anything when nothing was transferred', async () => {
    const { h, plex, jellyfin, destination } = await reporting();
    await put(
      join(movieFolder(destination, 'Dune (2021) {tmdb-438631}'), 'Dune (2021) {tmdb-438631}.mkv'),
      'taken',
    );

    await apply(h, { 'Dune.2021.1080p.mkv': 'dune' });

    expect(plexRefreshes(plex)).toEqual([]);
    expect(jellyfin.received).toEqual([]);
  });
});

describe('when something fails before any transfer', () => {
  it('tells about a job whose analysis failed, with the code a tool can route on', async () => {
    const { h, hook, plex } = await reporting();

    const job = (await h.request('POST', '/api/jobs', { path: '/no/such/folder' })).json<{
      id: string;
    }>();
    await h.app.jobs.idle();
    await h.app.notifier.idle();

    expect(job.id).toBeDefined();
    expect(hook.received.map((r) => r.url).sort()).toEqual(['/generic', '/gotify']);
    expect(json(hook.received.find((r) => r.url === '/generic') as Received)).toMatchObject({
      event: 'failed',
      reason: 'job',
      title: 'Analysis failed',
      error: { code: 'discover.not-found', params: { path: '/no/such/folder' } },
      job: { path: '/no/such/folder' },
    });
    expect(plex.received).toEqual([]);
  });

  it('tells about a transfer that failed outright', async () => {
    const hook = await fakeServer();
    const notifier = new Notifier({
      config: { notify: { webhooks: [{ url: `${hook.url}/generic` }] } },
      translate: (await import('@kinoshelf/i18n')).createTranslator('en'),
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      delivery: instant,
    });
    const job = { id: 'j1', path: '/downloads/x' } as Job;
    const execution = { id: 'x1', batchId: 'b1' } as Execution;

    notifier.executionFailed(job, execution, {
      code: 'internal.unexpected',
      params: { message: 'boom' },
    });
    await notifier.idle();

    expect(json(hook.received[0] as Received)).toMatchObject({
      event: 'failed',
      reason: 'execution',
      title: 'Transfer failed',
      execution: { id: 'x1', batchId: 'b1' },
      error: { code: 'internal.unexpected' },
    });
  });
});

describe('files that wait for a human', () => {
  it('reaches only the targets that asked for them', async () => {
    const hook = await fakeServer();
    const { h } = await reporting({
      webhooks: [
        { url: `${hook.url}/default` },
        { url: `${hook.url}/review`, on: ['needs-review'] },
      ],
    });

    const source = await makeDir();
    await put(join(source, 'Mystery.Home.Video.mkv'));
    await h.request('POST', '/api/jobs', { path: source });
    await h.app.jobs.idle();
    await h.app.notifier.idle();

    expect(hook.received.map((r) => r.url)).toEqual(['/review']);
    expect(json(hook.received[0] as Received)).toMatchObject({
      event: 'needs-review',
      title: '1 file(s) to review',
      review: { ambiguous: 0, unrecognized: 1, conflict: 0 },
    });
  });
});

describe('a target that cannot be reached', () => {
  it('costs a log line, never the transfer', async () => {
    const gone = await fakeServer();
    const goneUrl = gone.url;
    await gone.close();
    const { h, destination } = await reporting({
      webhooks: [{ url: `${goneUrl}/hook?token=SECRET` }],
    });

    const jobId = await apply(h, { 'Dune.2021.1080p.mkv': 'dune' });

    const job = (await h.request('GET', `/api/jobs/${jobId}`)).json<{
      execution: { status: string; summary: { done: number } };
    }>();
    expect(job.execution).toMatchObject({ status: 'done', summary: { done: 1 } });
    expect(
      readFileSync(
        join(destination, 'Dune (2021) {tmdb-438631}', 'Dune (2021) {tmdb-438631}.mkv'),
        'utf8',
      ),
    ).toBe('dune');
  });
});

describe('POST /api/notifications/test', () => {
  it('reaches every target whatever it listens to, and says how each went', async () => {
    const { h, hook, plex, jellyfin } = await reporting();

    const response = await h.request('POST', '/api/notifications/test');
    const results = response.json<{ target: string; kind: string; ok: boolean }[]>();

    expect(response.statusCode).toBe(200);
    expect(results.map((r) => [r.kind, r.ok])).toEqual([
      ['webhook', true],
      ['webhook', true],
      ['plex', true],
      ['jellyfin', true],
    ]);
    expect(hook.received.map((r) => r.url).sort()).toEqual(['/generic', '/gotify']); // even the one listening to failures
    expect(json(hook.received[0] as Received)).toMatchObject({
      event: 'test',
      title: 'Kinoshelf test',
    });
    expect(plex.received.map((r) => r.url)).toEqual(['/library/sections']);
    expect(jellyfin.received[0]).toMatchObject({ method: 'GET', url: '/Library/VirtualFolders' });
  });

  it('shows a target without its secret, and what is wrong with it', async () => {
    const closed = await fakeServer();
    const url = closed.url;
    await closed.close();
    const { h } = await reporting({ webhooks: [{ url: `${url}/hook?token=SECRET` }] });

    const results = (await h.request('POST', '/api/notifications/test')).json<
      { target: string; kind: string; ok: boolean; error?: string }[]
    >();

    const webhook = results.find((r) => r.kind === 'webhook');
    expect(webhook).toMatchObject({ ok: false, target: `${url}/…` });
    expect(JSON.stringify(results)).not.toContain('SECRET');
  });

  it('answers an empty list when nothing is configured', async () => {
    const h = await harness();
    expect((await h.request('POST', '/api/notifications/test')).json()).toEqual([]);
  });
});
