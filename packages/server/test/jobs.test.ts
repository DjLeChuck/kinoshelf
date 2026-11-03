import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrated } from '../src/database.js';
import { EntryStore } from '../src/entries.js';
import { ExecutionStore } from '../src/executions.js';
import { JobStore, type ProcessedJob } from '../src/jobs.js';
import { JobRunner } from '../src/runner.js';
import { cleanup, harness, jobEntries, librariesAt, makeDir, put } from './harness.js';

afterEach(cleanup);

interface JobBody {
  id: string;
  status: string;
  error: { code: string; params?: Record<string, unknown> } | null;
  summary: Record<string, number> | null;
  settings: { profile: string; mode: string } | null;
  batchId: string | null;
}

interface EntryBody {
  path: string;
  classification: string;
  destination: string | null;
}

describe('POST /api/jobs', () => {
  it('refuses the root of the disk and the kernel folders', async () => {
    const h = await harness();
    for (const path of ['/', '/proc', '/proc/self/fd', '/sys/class', '/dev/zero', '/x/../proc']) {
      const refused = await h.request('POST', '/api/jobs', { path });
      expect(refused.statusCode).toBe(422);
      expect(refused.json()).toEqual({ error: { code: 'fs.system-folder', params: { path } } });
    }
    // A folder merely named like one is not one.
    expect((await h.request('POST', '/api/jobs', { path: '/procedures' })).statusCode).toBe(202);
  });

  it('refuses a selection longer than any page offers', async () => {
    const h = await harness();
    const entries = Array.from({ length: 5001 }, (_, n) => `e${String(n)}`);
    const refused = await h.request(
      'POST',
      '/api/plans/00000000-0000-4000-8000-000000000000/execute',
      {
        entries,
      },
    );
    expect(refused.statusCode).toBe(400);
  });

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
    expect(job.settings?.mode).toBeTruthy();
    expect(job.settings?.profile).toBeTruthy();

    const entries = jobEntries<EntryBody>(h, id);
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
    const h = await harness({
      config: { libraries: [...librariesAt('/media')] },
      realProvider: true,
    });
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

function newQueue(): { jobs: JobStore; executions: ExecutionStore } {
  const database = migrated(new Database(':memory:'));
  const executions = new ExecutionStore(database);
  return { jobs: new JobStore(database, new EntryStore(database), executions), executions };
}

const done = { summary: { done: 0, failed: 0 }, files: [] };

describe('GET /api/jobs', () => {
  it('answers 404 for an unknown job', async () => {
    const h = await harness({
      processor: () => Promise.resolve(empty),
    });
    expect((await h.request('GET', '/api/jobs/nope')).statusCode).toBe(404);
  });
});

describe('JobRunner', () => {
  const idle = () => Promise.resolve(done);

  it('serves jobs in submission order, one at a time', async () => {
    const { jobs, executions } = newQueue();
    const order: string[] = [];
    let running = 0;
    const runner = new JobRunner(
      jobs,
      executions,
      async (job) => {
        expect(++running).toBe(1);
        order.push(job.path);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return empty;
      },
      idle,
    );
    for (const path of ['/a', '/b', '/c']) {
      jobs.create(path);
    }
    runner.kick();
    await runner.idle();
    expect(order).toEqual(['/a', '/b', '/c']);
  });

  it('serves a transfer before the next analysis, one task at a time', async () => {
    const { jobs, executions } = newQueue();
    const order: string[] = [];
    const runner = new JobRunner(
      jobs,
      executions,
      (job) => {
        order.push(`analyze ${job.path}`);
        return Promise.resolve(empty);
      },
      (execution) => {
        order.push(`transfer ${execution.jobId}`);
        return Promise.resolve(done);
      },
    );
    jobs.create('/a');
    jobs.create('/b');
    executions.create('job-x');
    runner.kick();
    await runner.idle();
    expect(order).toEqual(['transfer job-x', 'analyze /a', 'analyze /b']);
  });

  describe('two lanes', () => {
    /** A task that ends when told to, to hold a lane open. */
    function gate(): { open: () => void; closed: Promise<void> } {
      let open = (): void => undefined;
      const closed = new Promise<void>((resolve) => {
        open = resolve;
      });
      return { open, closed };
    }

    const setup = (overlaps?: (job: { path: string }, transferOf: string) => boolean) => {
      const { jobs, executions } = newQueue();
      const events: string[] = [];
      const transfer = gate();
      const source = jobs.create('/downloads/show');
      const scan = jobs.create('/media/films');
      executions.create(source.id);
      const runner = new JobRunner(
        jobs,
        executions,
        (job) => {
          events.push(`scan ${job.path}`);
          return Promise.resolve(empty);
        },
        async () => {
          events.push('transfer start');
          await transfer.closed;
          events.push('transfer end');
          return done;
        },
        overlaps && {
          overlaps: (job, execution) => overlaps(job, jobs.get(execution.jobId)?.path ?? ''),
        },
      );
      return { runner, events, transfer, scan };
    };

    it('runs a scan beside a transfer that touches other folders', async () => {
      const { runner, events, transfer } = setup(() => false);
      runner.kick();
      await new Promise((resolve) => setTimeout(resolve, 20));
      // The first job is the one the transfer belongs to; both lanes work while it is open.
      expect(events).toContain('transfer start');
      expect(events).toContain('scan /downloads/show');
      expect(events).not.toContain('transfer end');
      transfer.open();
      await runner.idle();
      expect(events).toContain('scan /media/films');
    });

    it('holds a scan back while a transfer touches its folder', async () => {
      const { runner, events, transfer } = setup((job) => job.path === '/media/films');
      runner.kick();
      await new Promise((resolve) => setTimeout(resolve, 20));
      // The scan of the source folder is free, the scan of the films is not: it needs the transfer's end.
      expect(events).not.toContain('scan /media/films');
      transfer.open();
      await runner.idle();
      expect(events.indexOf('scan /media/films')).toBeGreaterThan(events.indexOf('transfer end'));
    });

    it('serves one task at a time when nothing says they may overlap', async () => {
      const { runner, events, transfer } = setup();
      runner.kick();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(events).toEqual(['transfer start']);
      transfer.open();
      await runner.idle();
      expect(events[1]).toBe('transfer end');
    });
  });

  it('picks up after a crash: what was running is run again', async () => {
    const { jobs, executions } = newQueue();
    const job = jobs.create('/a');
    expect(jobs.claimNext()?.id).toBe(job.id); // the previous process died here...
    const execution = executions.create('job-x');
    expect(executions.claimNext()?.id).toBe(execution.id); // ...and here
    expect(jobs.get(job.id)?.status).toBe('running');
    expect(executions.get(execution.id)?.status).toBe('running');

    const runner = new JobRunner(jobs, executions, () => Promise.resolve(empty), idle);
    runner.start();
    await runner.idle();
    expect(jobs.get(job.id)?.status).toBe('done');
    expect(executions.get(execution.id)?.status).toBe('done');
  });

  it('records a failed transfer with its error and goes on', async () => {
    const { jobs, executions } = newQueue();
    const execution = executions.create('job-x');
    jobs.create('/a');
    const runner = new JobRunner(
      jobs,
      executions,
      () => Promise.resolve(empty),
      () => Promise.reject(new Error('disk on fire')),
    );
    runner.kick();
    await runner.idle();
    expect(executions.get(execution.id)).toMatchObject({
      status: 'failed',
      error: { code: 'internal.unexpected', params: { message: 'disk on fire' } },
    });
    expect(jobs.list(1)[0]?.status).toBe('done');
  });

  it('does not let a failing notification fail the task it reports on', async () => {
    const { jobs, executions } = newQueue();
    const job = jobs.create('/a');
    const execution = executions.create(job.id);
    const errors: unknown[] = [];
    const boom = (): never => {
      throw new Error('notifier is down');
    };
    const runner = new JobRunner(
      jobs,
      executions,
      () => Promise.resolve(empty),
      idle,
      { jobDone: boom, executionDone: boom },
      (error) => errors.push(error),
    );
    runner.kick();
    await runner.idle();

    expect(jobs.get(job.id)?.status).toBe('done');
    expect(executions.get(execution.id)?.status).toBe('done');
    expect(errors).toHaveLength(2); // both reported, none thrown
  });

  it('queues several executions for a job and runs them in order', () => {
    const { executions } = newQueue();
    const first = executions.create('job-x');
    const second = executions.create('job-x');
    expect(executions.claimNext()?.id).toBe(first.id);
    expect(executions.create('job-x').status).toBe('queued'); // one is running: still accepted
    expect(executions.claimNext()?.id).toBe(second.id);
  });

  it('starts no task once stopped, and leaves none half claimed', async () => {
    const { jobs, executions } = newQueue();
    jobs.create('/a');
    jobs.create('/b');
    const runner = new JobRunner(jobs, executions, () => Promise.resolve(empty), idle);
    await runner.stop();
    runner.kick();
    await runner.idle();
    expect(jobs.list(10).map((job) => job.status)).toEqual(['queued', 'queued']);
  });
});

describe('a scan beside a transfer', () => {
  /** Polls the job until it is no longer waiting or running, without a fixed sleep. */
  async function settled(h: Awaited<ReturnType<typeof harness>>, id: string): Promise<string> {
    for (let attempt = 0; attempt < 200; attempt++) {
      const { status } = (await h.request('GET', `/api/jobs/${id}`)).json<{ status: string }>();
      if (status === 'done' || status === 'failed') {
        return status;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return 'timeout';
  }

  it('lets the scan of another library through and holds the one of the destination', async () => {
    const films = await makeDir();
    const shows = await makeDir();
    const source = await makeDir();
    await put(join(source, 'Dune.2021.mkv'));
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = await harness({
      config: {
        libraries: [
          { id: 'films', name: 'Films', source: films, type: 'movie' },
          { id: 'shows', name: 'Shows', source: shows, type: 'series' },
        ],
      },
      // The transfer waits here, as a long copy would.
      executeWith: (run) => async (execution) => {
        await gate;
        return run(execution);
      },
    });
    try {
      const analysed = (await h.request('POST', '/api/jobs', { path: source })).json<{
        id: string;
      }>().id;
      await h.app.jobs.idle();
      expect((await h.request('POST', `/api/plans/${analysed}/execute`)).statusCode).toBe(202);

      const showsScan = (await h.request('POST', '/api/libraries/shows/scan')).json<{
        id: string;
      }>().id;
      const filmsScan = (await h.request('POST', '/api/libraries/films/scan')).json<{
        id: string;
      }>().id;

      // The series library is not touched by the transfer: its scan ends while the copy is open.
      expect(await settled(h, showsScan)).toBe('done');
      // The films are where the transfer writes: that scan waits for it.
      const waiting = (await h.request('GET', `/api/jobs/${filmsScan}`)).json<{ status: string }>();
      expect(waiting.status).toBe('queued');

      release();
      await h.app.jobs.idle();
      expect(await settled(h, filmsScan)).toBe('done');
    } finally {
      release();
    }
  });
});
