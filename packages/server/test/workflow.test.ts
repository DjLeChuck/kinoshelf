import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, harness, makeDir, put, type Harness } from './harness.js';

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

describe('POST /api/plans/{id}/execute', () => {
  it('writes nothing on a dry run', async () => {
    const h = await harness();
    const { jobId, dune } = await analyzed(h);

    const response = await h.request('POST', `/api/plans/${jobId}/execute`, { dryRun: true });
    const body = response.json<ExecutionBody>();
    expect(response.statusCode).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.items.map((i) => i.entryId)).toEqual([dune.id]);
    expect(await readdir(h.destination)).toEqual([]);

    const entry = (
      await h.request('GET', `/api/jobs/${jobId}/entries?classification=to-rename`)
    ).json<EntryBody[]>();
    expect(entry[0]?.resolution).toBeNull();
  });

  it('transfers the matched files, keeps the source (copy) and settles the entries', async () => {
    const h = await harness();
    const { jobId, dune, duneFile } = await analyzed(h);

    // No body at all: a bare POST is a real run.
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/plans/${jobId}/execute`,
      headers: { authorization: `Bearer ${h.apiKey}` },
    });
    const body = response.json<ExecutionBody>();
    expect(response.statusCode).toBe(200);
    expect(body.dryRun).toBe(false);
    expect(await readFile(duneTarget(h), 'utf8')).toBe('dune');
    expect((await stat(duneFile)).isFile()).toBe(true);

    const settled = (
      await h.request('GET', `/api/jobs/${jobId}/entries?classification=to-rename`)
    ).json<EntryBody[]>();
    expect(settled.find((e) => e.id === dune.id)).toMatchObject({
      resolution: 'done',
      batchId: body.batchId,
    });

    // Nothing left to do: a second run is empty.
    const again = (await h.request('POST', `/api/plans/${jobId}/execute`)).json<ExecutionBody>();
    expect(again.items).toEqual([]);
  });

  it('never overwrites: a destination taken in between fails the entry and returns it to the queue', async () => {
    const h = await harness();
    const { jobId, dune } = await analyzed(h);
    await put(duneTarget(h), 'someone else got here first');

    const body = (await h.request('POST', `/api/plans/${jobId}/execute`)).json<ExecutionBody>();
    expect(body.items[0]?.results[0]).toMatchObject({
      status: 'skipped',
      error: { code: 'destination.exists' },
    });
    expect(await readFile(duneTarget(h), 'utf8')).toBe('someone else got here first');

    const waiting = await queue(h);
    expect(waiting.find((e) => e.id === dune.id)).toMatchObject({
      resolution: 'failed',
      error: { code: 'destination.exists' },
    });
  });

  it('answers 404 for an unknown job', async () => {
    const h = await harness();
    expect((await h.request('POST', '/api/plans/nope/execute')).statusCode).toBe(404);
  });
});

describe('apply jobs', () => {
  it('transfer what matched in the same call and leave the rest in the queue', async () => {
    const h = await harness();
    const { jobId, mystery } = await analyzed(h, true);

    const job = (await h.request('GET', `/api/jobs/${jobId}`)).json<{
      status: string;
      batchId: string | null;
    }>();
    expect(job.status).toBe('done');
    expect(job.batchId).toEqual(expect.any(String));
    expect(await readFile(duneTarget(h), 'utf8')).toBe('dune');
    expect((await queue(h)).map((e) => e.id)).toEqual([mystery.id]);
  });
});

describe('POST /api/batches/{id}/undo', () => {
  it('puts things back and makes the files ready again', async () => {
    const h = await harness();
    const { jobId, dune } = await analyzed(h);
    const { batchId } = (
      await h.request('POST', `/api/plans/${jobId}/execute`)
    ).json<ExecutionBody>();

    const dry = await h.request('POST', `/api/batches/${batchId}/undo`, { dryRun: true });
    expect(dry.json<{ entries: { status: string }[] }>().entries[0]?.status).toBe('undone');
    expect((await stat(duneTarget(h))).isFile()).toBe(true);

    const undone = await h.request('POST', `/api/batches/${batchId}/undo`);
    expect(undone.statusCode).toBe(200);
    await expect(stat(duneTarget(h))).rejects.toThrow();

    const entries = (
      await h.request('GET', `/api/jobs/${jobId}/entries?classification=to-rename`)
    ).json<EntryBody[]>();
    expect(entries.find((e) => e.id === dune.id)).toMatchObject({
      resolution: null,
      batchId: null,
    });
    const again = (await h.request('POST', `/api/plans/${jobId}/execute`)).json<ExecutionBody>();
    expect(again.items).toHaveLength(1);
  });

  it('undoes an older batch and leaves the newer one alone', async () => {
    const h = await harness();
    const first = await analyzed(h);
    const one = (
      await h.request('POST', `/api/plans/${first.jobId}/execute`)
    ).json<ExecutionBody>();

    const source = await makeDir();
    await put(join(source, 'Alien.1979.1080p.mkv'));
    const alien = (await h.request('POST', '/api/jobs', { path: source, apply: true })).json<{
      id: string;
    }>();
    await h.app.jobs.idle();
    const { batchId: two } = (await h.request('GET', `/api/jobs/${alien.id}`)).json<{
      batchId: string;
    }>();
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

    const entries = (
      await h.request('GET', `/api/jobs/${first.jobId}/entries?classification=to-rename`)
    ).json<EntryBody[]>();
    expect(entries.find((e) => e.id === first.dune.id)).toMatchObject({
      resolution: null,
      batchId: null,
    });
    const alienEntries = (await h.request('GET', `/api/jobs/${alien.id}/entries`)).json<
      EntryBody[]
    >();
    expect(alienEntries[0]).toMatchObject({ resolution: 'done', batchId: two });
  });

  it('refuses a batch already undone with 409, and answers 404 for an unknown one', async () => {
    const h = await harness();
    const { jobId } = await analyzed(h);
    const { batchId } = (
      await h.request('POST', `/api/plans/${jobId}/execute`)
    ).json<ExecutionBody>();

    expect((await h.request('POST', `/api/batches/${batchId}/undo`)).statusCode).toBe(200);
    const again = await h.request('POST', `/api/batches/${batchId}/undo`);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: { code: 'batch.already-undone' } });
    expect((await h.request('POST', '/api/batches/nope/undo')).statusCode).toBe(404);
  });
});
