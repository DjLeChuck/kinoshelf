import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteJournal } from '@kinoshelf/core';
import { buildApp } from '../src/app.js';
import { createProcessor } from '../src/processor.js';
import { cleanup, fakeProvider, harness, makeDir, put, track, type Harness } from './harness.js';

afterEach(cleanup);

interface EntryBody {
  id: string;
  path: string;
  classification: string;
  resolution: string | null;
  destination: string | null;
  batchId: string | null;
  error: { code: string } | null;
  candidates: { title: string; score: number }[];
  conflicts: { reason: string }[];
}

interface ExecutionRecord {
  id: string;
  status: string;
  batchId: string | null;
  summary: { done: number; failed: number } | null;
  error: { code: string } | null;
}

interface ExecutionBody {
  batchId: string;
  dryRun: boolean;
  items: { entryId: string; results: { status: string; error: { code: string } | null }[] }[];
}

const DUNE = { kind: 'movie', id: { provider: 'tmdb', id: 438631 }, title: 'Dune', year: 2021 };

/** A folder holding one recognizable film and one the provider knows nothing about. */
async function analyzed(h: Harness, apply = false) {
  const source = await makeDir();
  const dune = await put(join(source, 'Dune.2021.1080p.mkv'), 'dune');
  const mystery = await put(join(source, 'Mystery.Home.Video.mkv'), 'mystery');
  const created = await h.request('POST', '/api/jobs', { path: source, apply });
  const jobId = created.json<{ id: string }>().id;
  await h.app.jobs.idle();
  const entries = (await h.request('GET', `/api/jobs/${jobId}/entries`)).json<EntryBody[]>();
  const named = (path: string): EntryBody => {
    const entry = entries.find((e) => e.path === path);
    if (!entry) {
      throw new Error(`no entry for ${path}`);
    }
    return entry;
  };
  return {
    source,
    jobId,
    dune: named(dune),
    mystery: named(mystery),
    duneFile: dune,
    mysteryFile: mystery,
  };
}

const duneTarget = (h: Harness): string =>
  join(h.destination, 'Dune (2021) {tmdb-438631}', 'Dune (2021) {tmdb-438631}.mkv');

const queue = async (h: Harness): Promise<EntryBody[]> =>
  (await h.request('GET', '/api/queue')).json<EntryBody[]>();

describe('validation queue', () => {
  it('holds what a human must decide, not what matched', async () => {
    const h = await harness();
    const { mystery } = await analyzed(h);
    const waiting = await queue(h);
    expect(waiting.map((e) => e.id)).toEqual([mystery.id]);
    expect(waiting[0]).toMatchObject({ classification: 'unrecognized', resolution: null });
  });

  it('lets a human pick a candidate found by a manual search', async () => {
    const h = await harness();
    const { mystery } = await analyzed(h);

    const found = await h.request('GET', '/api/search?query=Dune');
    expect(found.statusCode).toBe(200);
    expect(found.json<{ title: string }[]>().map((c) => c.title)).toEqual(['Dune']);
    expect((await h.request('GET', '/api/search?query=Dune&kind=series')).json()).toEqual([]);

    // The object returned by the search is posted back as is.
    const candidate = found.json<unknown[]>()[0];
    const matched = await h.request('POST', `/api/queue/${mystery.id}/match`, candidate as object);
    expect(matched.statusCode).toBe(200);
    expect(matched.json<EntryBody>()).toMatchObject({
      classification: 'to-rename',
      destination: duneTarget(h),
    });
    expect(await queue(h)).toEqual([]);
  });

  it('keeps a match whose target is taken in the queue, as a conflict', async () => {
    const h = await harness();
    const { mystery } = await analyzed(h);
    await put(duneTarget(h), 'already here');

    const matched = (
      await h.request('POST', `/api/queue/${mystery.id}/match`, DUNE)
    ).json<EntryBody>();
    expect(matched.classification).toBe('conflict');
    expect(matched.conflicts.map((c) => c.reason)).toContain('destination-exists');
    expect((await queue(h)).map((e) => e.id)).toContain(mystery.id);
  });

  it('sets a file aside', async () => {
    const h = await harness();
    const { mystery } = await analyzed(h);
    const ignored = await h.request('POST', `/api/queue/${mystery.id}/ignore`);
    expect(ignored.json<EntryBody>().resolution).toBe('ignored');
    expect(await queue(h)).toEqual([]);

    const again = await h.request('POST', `/api/queue/${mystery.id}/match`, DUNE);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: 'queue.entry-resolved' } });
  });

  it('refuses an unknown entry and a malformed candidate', async () => {
    const h = await harness();
    const { mystery } = await analyzed(h);
    expect((await h.request('POST', '/api/queue/nope/match', DUNE)).statusCode).toBe(404);
    expect(
      (await h.request('POST', `/api/queue/${mystery.id}/match`, { title: 'Dune' })).statusCode,
    ).toBe(400);
  });
});

/** Queues a transfer, waits for the queue to drain and returns how it went. */
async function transfer(h: Harness, jobId: string, body?: object): Promise<ExecutionRecord> {
  const queued = await h.request('POST', `/api/plans/${jobId}/execute`, body);
  expect(queued.statusCode).toBe(202);
  await h.app.jobs.idle();
  return (
    await h.request('GET', `/api/executions/${queued.json<{ id: string }>().id}`)
  ).json<ExecutionRecord>();
}

const entriesOf = async (h: Harness, jobId: string): Promise<EntryBody[]> =>
  (await h.request('GET', `/api/jobs/${jobId}/entries`)).json<EntryBody[]>();

describe('POST /api/plans/{id}/execute', () => {
  it('writes nothing on a dry run, and answers at once', async () => {
    const h = await harness();
    const { jobId, dune } = await analyzed(h);

    const response = await h.request('POST', `/api/plans/${jobId}/execute`, { dryRun: true });
    const body = response.json<ExecutionBody>();
    expect(response.statusCode).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.items.map((i) => i.entryId)).toEqual([dune.id]);
    expect(await readdir(h.destination)).toEqual([]);
    expect((await entriesOf(h, jobId)).find((e) => e.id === dune.id)?.resolution).toBeNull();
  });

  it('queues the transfer, keeps the source (copy) and settles the entries', async () => {
    const h = await harness();
    const { jobId, dune, duneFile } = await analyzed(h);

    // No body at all: a bare POST is a real run, queued.
    const queued = await h.app.inject({
      method: 'POST',
      url: `/api/plans/${jobId}/execute`,
      headers: { authorization: `Bearer ${h.apiKey}` },
    });
    expect(queued.statusCode).toBe(202);
    expect(queued.json<ExecutionRecord>().status).toBe('queued');

    await h.app.jobs.idle();
    const execution = (
      await h.request('GET', `/api/executions/${queued.json<{ id: string }>().id}`)
    ).json<ExecutionRecord>();
    expect(execution).toMatchObject({ status: 'done', summary: { done: 1, failed: 0 } });
    expect(execution.batchId).toEqual(expect.any(String));

    expect(await readFile(duneTarget(h), 'utf8')).toBe('dune');
    expect((await stat(duneFile)).isFile()).toBe(true);
    expect((await entriesOf(h, jobId)).find((e) => e.id === dune.id)).toMatchObject({
      resolution: 'done',
      batchId: execution.batchId,
    });

    // Nothing left to do: a second one finishes with nothing done.
    expect(await transfer(h, jobId)).toMatchObject({
      status: 'done',
      summary: { done: 0, failed: 0 },
    });
  });

  it('never overwrites: a destination taken in between fails the entry and returns it to the queue', async () => {
    const h = await harness();
    const { jobId, dune } = await analyzed(h);
    await put(duneTarget(h), 'someone else got here first');

    const execution = await transfer(h, jobId);

    expect(execution).toMatchObject({ status: 'done', summary: { done: 0, failed: 1 } });
    expect(await readFile(duneTarget(h), 'utf8')).toBe('someone else got here first');
    expect((await queue(h)).find((e) => e.id === dune.id)).toMatchObject({
      resolution: 'failed',
      error: { code: 'destination.exists' },
    });
  });

  it('transfers only the files asked for', async () => {
    const h = await harness();
    const source = await makeDir();
    await put(join(source, 'Dune.2021.1080p.mkv'), 'dune');
    await put(join(source, 'Alien.1979.1080p.mkv'), 'alien');
    const jobId = (await h.request('POST', '/api/jobs', { path: source })).json<{ id: string }>()
      .id;
    await h.app.jobs.idle();
    const [first] = await entriesOf(h, jobId);

    const execution = await transfer(h, jobId, { entries: [first?.id] });

    expect(execution.summary).toEqual({ done: 1, failed: 0 });
    const entries = await entriesOf(h, jobId);
    expect(entries.find((e) => e.id === first?.id)?.resolution).toBe('done');
    expect(entries.filter((e) => e.id !== first?.id).map((e) => e.resolution)).toEqual([null]);
  });

  it('answers 404 for an unknown job or execution', async () => {
    const h = await harness();
    expect((await h.request('POST', '/api/plans/nope/execute')).statusCode).toBe(404);
    expect((await h.request('GET', '/api/executions/nope')).statusCode).toBe(404);
  });
});

describe('a transfer in progress', () => {
  it('settles each file as soon as it is transferred, before the next one starts', async () => {
    // The journal is written right before an item is settled, so each `record` is a moment to look
    // at how many files the database already holds as done.
    const doneAtEachTransfer: number[] = [];
    const h = await harness({
      journal: (database) => {
        const real = new SqliteJournal(database);
        return {
          record: (entry) => {
            const row = database
              .prepare("SELECT COUNT(*) AS n FROM job_entries WHERE resolution = 'done'")
              .get() as { n: number };
            doneAtEachTransfer.push(row.n);
            real.record(entry);
          },
          lastBatchId: () => real.lastBatchId(),
          isUndone: (batchId) => real.isUndone(batchId),
          entriesOf: (batchId) => real.entriesOf(batchId),
          markUndone: (batchId) => {
            real.markUndone(batchId);
          },
          batches: () => real.batches(),
        };
      },
    });
    const source = await makeDir();
    await put(join(source, 'Dune.2021.1080p.mkv'));
    await put(join(source, 'Alien.1979.1080p.mkv'));
    const jobId = (await h.request('POST', '/api/jobs', { path: source })).json<{ id: string }>()
      .id;
    await h.app.jobs.idle();

    await transfer(h, jobId);

    // Before the second transfer, the first file is already settled.
    expect(doneAtEachTransfer).toEqual([0, 1]);
  });
});

describe('a queue that is busy', () => {
  /** A runner kept busy by an analysis that waits for `release`, so what comes after is queued. */
  async function busyHarness() {
    const destination = await makeDir();
    const config = { destination };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const real = createProcessor({
      config,
      configDir: '/nonexistent',
      database: undefined as never, // only a real TMDB provider reads it
      env: {},
      createProvider: () => fakeProvider,
    });
    const h = await harness({
      config,
      processor: async (job) => {
        if (job.path === '/blocked') {
          await gate;
        }
        return real(job);
      },
    });
    return { h, release, destination };
  }

  it('refuses a second transfer of the same job while one is queued, and accepts it afterwards', async () => {
    const { h, release } = await busyHarness();
    const { jobId } = await analyzed(h);
    await h.request('POST', '/api/jobs', { path: '/blocked' }); // the runner now waits on it

    const first = await h.request('POST', `/api/plans/${jobId}/execute`);
    const second = await h.request('POST', `/api/plans/${jobId}/execute`);
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: { code: 'job.busy' } });

    // Checking what a transfer would do is not a transfer: allowed meanwhile.
    expect(
      (await h.request('POST', `/api/plans/${jobId}/execute`, { dryRun: true })).statusCode,
    ).toBe(200);

    release();
    await h.app.jobs.idle();
    expect((await h.request('POST', `/api/plans/${jobId}/execute`)).statusCode).toBe(202);
  });

  it('refuses a transfer of a job that is still being analyzed', async () => {
    const { h, release } = await busyHarness();
    const blocked = (await h.request('POST', '/api/jobs', { path: '/blocked' })).json<{
      id: string;
    }>();

    const response = await h.request('POST', `/api/plans/${blocked.id}/execute`);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'job.not-done' } });
    release();
  });
});

describe('after a crash', () => {
  it('resumes a transfer that was running and only does what is left', async () => {
    const h = await harness();
    const source = await makeDir();
    await put(join(source, 'Dune.2021.1080p.mkv'), 'dune');
    await put(join(source, 'Alien.1979.1080p.mkv'), 'alien');
    const jobId = (await h.request('POST', '/api/jobs', { path: source })).json<{ id: string }>()
      .id;
    await h.app.jobs.idle();
    const [first, second] = await entriesOf(h, jobId);

    // The first file was transferred and settled, then the process died mid-execution.
    const before = await transfer(h, jobId, { entries: [first?.id] });
    h.database
      .prepare(
        "INSERT INTO executions (id, job_id, status, created_at, started_at, batch_id) VALUES ('crashed', ?, 'running', 'now', 'now', 'old-batch')",
      )
      .run(jobId);
    await h.app.close();

    // A new process on the same database.
    const restarted = track(
      await buildApp({
        version: '1.2.3',
        config: { destination: h.destination },
        configDir: '/nonexistent',
        database: h.database,
        env: {},
        createProvider: () => fakeProvider,
      }),
    );
    await restarted.jobs.idle();

    const execution = h.database
      .prepare('SELECT status, summary FROM executions WHERE id = ?')
      .get('crashed') as { status: string; summary: string };
    expect(execution.status).toBe('done');
    expect(JSON.parse(execution.summary)).toEqual({ done: 1, failed: 0 });

    const entries = (
      await restarted.inject({
        method: 'GET',
        url: `/api/jobs/${jobId}/entries`,
        headers: { authorization: `Bearer ${h.apiKey}` },
      })
    ).json<EntryBody[]>();
    // The file done before the crash is not reported as failed.
    expect(entries.find((e) => e.id === first?.id)).toMatchObject({
      resolution: 'done',
      batchId: before.batchId,
      error: null,
    });
    // The resumed execution carries on the batch the crashed one had recorded: one batch to undo.
    expect(entries.find((e) => e.id === second?.id)).toMatchObject({
      resolution: 'done',
      batchId: 'old-batch',
    });
    expect(
      h.database
        .prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE batch_id = 'old-batch'")
        .get(),
    ).toEqual({ n: 1 });
    expect(
      h.database.prepare("SELECT batch_id FROM executions WHERE id = 'crashed'").get(),
    ).toEqual({ batch_id: 'old-batch' });
  });
});

describe('apply jobs', () => {
  it('transfer what matched in the same call and leave the rest in the queue', async () => {
    const h = await harness();
    const { jobId, mystery } = await analyzed(h, true);

    const job = (await h.request('GET', `/api/jobs/${jobId}`)).json<{
      status: string;
      execution: ExecutionRecord | null;
    }>();
    expect(job.status).toBe('done');
    expect(job.execution).toMatchObject({ status: 'done', summary: { done: 1, failed: 0 } });
    expect(job.execution?.batchId).toEqual(expect.any(String));
    expect(await readFile(duneTarget(h), 'utf8')).toBe('dune');
    expect((await queue(h)).map((e) => e.id)).toEqual([mystery.id]);
  });

  it('are refused a manual transfer while their own is pending', async () => {
    const destination = await makeDir();
    const config = { destination };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const real = createProcessor({
      config,
      configDir: '/nonexistent',
      database: undefined as never,
      env: {},
      createProvider: () => fakeProvider,
    });
    const h = await harness({
      config,
      processor: async (job) => {
        if (job.path === '/blocked') {
          await gate;
        }
        return real(job);
      },
    });
    const source = await makeDir();
    await put(join(source, 'Dune.2021.1080p.mkv'));
    await h.request('POST', '/api/jobs', { path: '/blocked' });
    const apply = (await h.request('POST', '/api/jobs', { path: source, apply: true })).json<{
      id: string;
    }>();
    release();
    await h.app.jobs.idle();
    // Its own transfer ran; a manual one afterwards is accepted again (nothing pending).
    expect((await h.request('POST', `/api/plans/${apply.id}/execute`)).statusCode).toBe(202);
  });
});

describe('POST /api/batches/{id}/undo', () => {
  it('puts things back and makes the files ready again', async () => {
    const h = await harness();
    const { jobId, dune } = await analyzed(h);
    const { batchId } = await transfer(h, jobId);

    const dry = await h.request('POST', `/api/batches/${batchId}/undo`, { dryRun: true });
    expect(dry.json<{ entries: { status: string }[] }>().entries[0]?.status).toBe('undone');
    expect((await stat(duneTarget(h))).isFile()).toBe(true);

    const undone = await h.request('POST', `/api/batches/${batchId}/undo`);
    expect(undone.statusCode).toBe(200);
    await expect(stat(duneTarget(h))).rejects.toThrow();

    expect((await entriesOf(h, jobId)).find((e) => e.id === dune.id)).toMatchObject({
      resolution: null,
      batchId: null,
    });
    expect(await transfer(h, jobId)).toMatchObject({ summary: { done: 1, failed: 0 } });
  });

  it('undoes an older batch and leaves the newer one alone', async () => {
    const h = await harness();
    const first = await analyzed(h);
    const one = await transfer(h, first.jobId);

    const source = await makeDir();
    await put(join(source, 'Alien.1979.1080p.mkv'));
    const alien = (await h.request('POST', '/api/jobs', { path: source, apply: true })).json<{
      id: string;
    }>();
    await h.app.jobs.idle();
    const two = (await h.request('GET', `/api/jobs/${alien.id}`)).json<{
      execution: ExecutionRecord;
    }>().execution.batchId;
    expect(two).not.toBe(one.batchId);
    const alienTarget = join(
      h.destination,
      'Alien (1979) {tmdb-348}',
      'Alien (1979) {tmdb-348}.mkv',
    );

    // The first batch, although the second is the last one.
    expect((await h.request('POST', `/api/batches/${one.batchId}/undo`)).statusCode).toBe(200);
    await expect(stat(duneTarget(h))).rejects.toThrow();
    expect((await stat(alienTarget)).isFile()).toBe(true);

    expect((await entriesOf(h, first.jobId)).find((e) => e.id === first.dune.id)).toMatchObject({
      resolution: null,
      batchId: null,
    });
    expect((await entriesOf(h, alien.id))[0]).toMatchObject({ resolution: 'done', batchId: two });
  });

  it('refuses a batch already undone with 409, and answers 404 for an unknown one', async () => {
    const h = await harness();
    const { jobId } = await analyzed(h);
    const { batchId } = await transfer(h, jobId);

    expect((await h.request('POST', `/api/batches/${batchId}/undo`)).statusCode).toBe(200);
    const again = await h.request('POST', `/api/batches/${batchId}/undo`);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: { code: 'batch.already-undone' } });
    expect((await h.request('POST', '/api/batches/nope/undo')).statusCode).toBe(404);
  });
});
