import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrated } from '../src/database.js';
import { EntryStore } from '../src/entries.js';
import { JobStore, type ProcessedJob } from '../src/jobs.js';
import { JobRunner } from '../src/runner.js';
import { cleanup, harness, makeDir, put } from './harness.js';

afterEach(cleanup);

interface JobBody {
  id: string;
  status: string;
  error: { code: string; params?: Record<string, unknown> } | null;
  summary: Record<string, number> | null;
  batchId: string | null;
}

interface EntryBody {
  path: string;
  classification: string;
  destination: string | null;
}

describe('POST /api/jobs', () => {
  it('queues a job and analyzes it without touching the disk', async () => {
    const h = await harness();
    const source = await makeDir();
    const file = await put(join(source, 'Dune.2021.1080p.mkv'));
    await put(join(source, 'Unknown.Home.Video.mkv'));

    const created = await h.request('POST', '/api/jobs', { path: source });
    expect(created.statusCode).toBe(202);
    expect(created.json<JobBody>().status).toBe('queued');

    await h.app.jobs.idle();
    const id = created.json<JobBody>().id;
    const job = (await h.request('GET', `/api/jobs/${id}`)).json<JobBody>();
    expect(job.status).toBe('done');
    expect(job.summary).toMatchObject({ 'to-rename': 1, unrecognized: 1 });

    const entries = (await h.request('GET', `/api/jobs/${id}/entries`)).json<EntryBody[]>();
    const renamed = entries.find((entry) => entry.path === file);
    expect(renamed?.classification).toBe('to-rename');
    expect(renamed?.destination).toBe(
      join(h.destination, 'Dune (2021) {tmdb-438631}', 'Dune (2021) {tmdb-438631}.mkv'),
    );
    expect(
      entries.find((entry) => entry.classification === 'unrecognized')?.destination,
    ).toBeNull();
    // Analysis alone writes nothing.
    expect(await readdir(h.destination)).toEqual([]);

    const filtered = await h.request('GET', `/api/jobs/${id}/entries?classification=unrecognized`);
    expect(filtered.json<EntryBody[]>()).toHaveLength(1);
    const paged = await h.request('GET', `/api/jobs/${id}/entries?limit=1&offset=1`);
    expect(paged.json<EntryBody[]>()).toHaveLength(1);
  });

  it('fails the job with a code when the path does not exist', async () => {
    const h = await harness();
    const created = await h.request('POST', '/api/jobs', { path: '/no/such/path' });
    await h.app.jobs.idle();
    const job = (await h.request('GET', `/api/jobs/${created.json<JobBody>().id}`)).json<JobBody>();
    expect(job).toMatchObject({
      status: 'failed',
      error: { code: 'discover.not-found', params: { path: '/no/such/path' } },
    });
  });

  it('fails the job when no destination is configured', async () => {
    const h = await harness({ config: {} });
    const source = await makeDir();
    await put(join(source, 'Dune.2021.mkv'));
    const created = await h.request('POST', '/api/jobs', { path: source });
    await h.app.jobs.idle();
    const job = (await h.request('GET', `/api/jobs/${created.json<JobBody>().id}`)).json<JobBody>();
    expect(job.error?.code).toBe('config.destination-required');
  });

  it('fails the job when the TMDB key is missing', async () => {
    const h = await harness({ config: { destination: '/media' }, realProvider: true });
    const source = await makeDir();
    await put(join(source, 'Dune.2021.mkv'));
    const created = await h.request('POST', '/api/jobs', { path: source });
    await h.app.jobs.idle();
    const job = (await h.request('GET', `/api/jobs/${created.json<JobBody>().id}`)).json<JobBody>();
    expect(job.error?.code).toBe('config.tmdb-key-missing');
  });

  it.each([
    ['a relative path', { path: 'movies/Dune.mkv' }],
    ['no path', {}],
    ['an unknown field', { path: '/a', dryRun: true }],
  ])('rejects %s', async (_name, body) => {
    const h = await harness();
    const response = await h.request('POST', '/api/jobs', body);
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('request.invalid');
  });

  it('reports a bug as an unexpected error rather than crashing the queue', async () => {
    const h = await harness({
      processor: () => Promise.reject(new Error('boom')),
    });
    const first = await h.request('POST', '/api/jobs', { path: '/a' });
    await h.app.jobs.idle();
    const job = (await h.request('GET', `/api/jobs/${first.json<JobBody>().id}`)).json<JobBody>();
    expect(job.error).toEqual({ code: 'internal.unexpected', params: { message: 'boom' } });
  });
});

const empty: ProcessedJob = {
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

function newQueue(): JobStore {
  const database = migrated(new Database(':memory:'));
  return new JobStore(database, new EntryStore(database));
}

describe('GET /api/jobs', () => {
  it('lists newest first and answers 404 for an unknown job', async () => {
    const h = await harness({
      processor: () => Promise.resolve(empty),
    });
    await h.request('POST', '/api/jobs', { path: '/first' });
    await h.request('POST', '/api/jobs', { path: '/second' });
    await h.app.jobs.idle();

    const list = (await h.request('GET', '/api/jobs')).json<{ path: string }[]>();
    expect(list.map((job) => job.path)).toEqual(['/second', '/first']);
    expect((await h.request('GET', '/api/jobs/nope')).statusCode).toBe(404);
  });
});

describe('JobRunner', () => {
  it('serves jobs in submission order, one at a time', async () => {
    const store = newQueue();
    const order: string[] = [];
    let running = 0;
    const runner = new JobRunner(
      store,
      async (job) => {
        expect(++running).toBe(1);
        order.push(job.path);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return empty;
      },
      () => Promise.resolve('batch'),
    );
    for (const path of ['/a', '/b', '/c']) {
      store.create(path);
    }
    runner.kick();
    await runner.idle();
    expect(order).toEqual(['/a', '/b', '/c']);
  });

  it('picks up after a crash: a job left running is run again', async () => {
    const store = newQueue();
    const job = store.create('/a');
    expect(store.claimNext()?.id).toBe(job.id); // the previous process died here
    expect(store.get(job.id)?.status).toBe('running');

    const runner = new JobRunner(
      store,
      () => Promise.resolve(empty),
      () => Promise.resolve('batch'),
    );
    runner.start();
    await runner.idle();
    expect(store.get(job.id)?.status).toBe('done');
  });

  it('starts no job once stopped, and leaves none half claimed', async () => {
    const store = newQueue();
    store.create('/a');
    store.create('/b');
    const runner = new JobRunner(
      store,
      () => Promise.resolve(empty),
      () => Promise.resolve('batch'),
    );
    await runner.stop();
    runner.kick();
    await runner.idle();
    expect(store.list(10).map((job) => job.status)).toEqual(['queued', 'queued']);
  });
});
