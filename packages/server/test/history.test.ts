import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteJournal } from '@kinoshelf/core';
import { cleanup, harness, batchOf, makeDir, put, type Harness } from './harness.js';

afterEach(cleanup);

interface BatchBody {
  id: string;
  at: string;
  status: 'done' | 'undone' | 'failed';
  operations: number;
  modes: string[];
  failed: number;
  origin: { jobId: string; path: string } | null;
  error: { code: string } | null;
  items?: {
    source: string;
    destination: string | null;
    mode: string;
    status: string;
    error: { code: string } | null;
  }[];
}

/** Analyzes a folder holding `Dune.2021.mkv` and executes its plan; returns the batch id. */
async function run(
  h: Harness,
  /** Runs between the analysis and the transfer, to change what the disk holds. */
  between: () => Promise<unknown> = () => Promise.resolve(),
): Promise<{ source: string; batchId: string }> {
  const source = await makeDir();
  await put(join(source, 'Dune.2021.1080p.mkv'), 'dune');
  const job = (await h.request('POST', '/api/jobs', { path: source })).json<{ id: string }>();
  await h.app.jobs.idle();
  await between();
  const execution = (await h.request('POST', `/api/plans/${job.id}/execute`)).json<{
    id: string;
  }>();
  await h.app.jobs.idle();
  const batchId = batchOf(h, execution.id);
  return { source, batchId };
}

interface Line {
  id: string;
  kind: 'batch' | 'job';
  status: string;
  path: string | null;
  libraryId: string | null;
  operations: number;
  modes: string[];
  failed: number;
  error: { code: string } | null;
  routine: boolean;
}

const view = async (h: Harness, query = ''): Promise<{ total: number; items: Line[] }> =>
  (await h.request('GET', `/api/history${query}`)).json<{ total: number; items: Line[] }>();

const list = async (h: Harness, query = ''): Promise<Line[]> => (await view(h, query)).items;

describe('GET /api/history', () => {
  it('is empty before anything ran', async () => {
    const h = await harness();
    expect(await list(h)).toEqual([]);
  });

  it('lists a batch with its origin, then marks it undone', async () => {
    const h = await harness();
    const { source, batchId } = await run(h);

    const [batch, ...rest] = await list(h);
    expect(rest).toEqual([]);
    expect(batch).toMatchObject({
      id: batchId,
      status: 'done',
      operations: 1,
      modes: ['copy'],
      failed: 0,
      path: source,
      kind: 'batch',
      error: null,
    });

    await h.request('POST', `/api/batches/${batchId}/undo`);
    expect((await list(h))[0]?.status).toBe('undone');
  });

  it('shows an execution that moved nothing as failed, with the reason', async () => {
    const h = await harness();
    // The destination of the film is taken after the analysis, before the transfer.
    const { batchId } = await run(h, () =>
      put(
        join(h.destination, 'Dune (2021) {tmdb-438631}', 'Dune (2021) {tmdb-438631}.mkv'),
        'someone else',
      ),
    );

    const [batch] = await list(h);
    expect(batch).toMatchObject({
      id: batchId,
      status: 'failed',
      operations: 0,
      failed: 1,
      error: { code: 'destination.exists' },
    });
    const detail = (await h.request('GET', `/api/batches/${batchId}`)).json<BatchBody>();
    expect(detail.items).toEqual([
      expect.objectContaining({
        status: 'failed',
        error: expect.objectContaining({ code: 'destination.exists' }) as unknown,
      }),
    ]);
  });

  it('lists a batch made outside the server, without an origin', async () => {
    const h = await harness();
    new SqliteJournal(h.database).record({
      kind: 'transfer',
      id: 'x1',
      batchId: 'from-cli',
      source: '/a.mkv',
      destination: '/b.mkv',
      mode: 'move',
      createdDirectories: [],
      at: '2026-10-28T08:00:00.000Z',
    });
    expect(await list(h)).toEqual([
      expect.objectContaining({ id: 'from-cli', path: null, modes: ['move'], status: 'done' }),
    ]);
  });

  it('pages, newest first', async () => {
    const h = await harness();
    const first = await run(h);
    const second = await run(h);
    expect((await list(h)).map((b) => b.id)).toEqual([second.batchId, first.batchId]);
    expect((await list(h, '?limit=1')).map((b) => b.id)).toEqual([second.batchId]);
    expect((await list(h, '?limit=1&offset=1')).map((b) => b.id)).toEqual([first.batchId]);
  });
});

describe('GET /api/batches/:id', () => {
  it('details every operation', async () => {
    const h = await harness();
    const { batchId } = await run(h);
    const detail = (await h.request('GET', `/api/batches/${batchId}`)).json<BatchBody>();
    expect(detail.items).toEqual([
      {
        source: expect.stringMatching(/Dune\.2021\.1080p\.mkv$/) as string,
        destination: expect.stringMatching(/Dune \(2021\) \{tmdb-438631\}\.mkv$/) as string,
        mode: 'copy',
        status: 'done',
        error: null,
      },
    ]);
  });

  it('answers 404 for an unknown batch', async () => {
    const h = await harness();
    const response = await h.request('GET', '/api/batches/nope');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: 'batch.not-found' } });
  });
});

describe('GET /api/history, jobs', () => {
  const submit = async (h: Harness, path: string, apply = false): Promise<string> =>
    (await h.request('POST', '/api/jobs', { path, apply })).json<{ id: string }>().id;

  it('lists a job that failed, with its cause, and no job that has a batch', async () => {
    const h = await harness();
    const { batchId } = await run(h);
    const failed = await submit(h, '/no/such/path');
    await h.app.jobs.idle();

    const lines = await list(h);
    // The job of the batch is its batch: one line, not two.
    expect(lines.map((line) => [line.kind, line.id])).toEqual(
      expect.arrayContaining([
        ['job', failed],
        ['batch', batchId],
      ]),
    );
    expect(lines).toHaveLength(2);
    expect(lines.find((line) => line.id === failed)).toMatchObject({
      status: 'failed',
      path: '/no/such/path',
      error: { code: 'discover.not-found' },
      routine: false,
    });
  });

  it('lists a job that waits or runs', async () => {
    const h = await harness();
    // Nothing kicks the runner before `idle`, so the job is still queued.
    const queued = await submit(h, await makeDir());
    expect((await list(h))[0]).toMatchObject({ id: queued, kind: 'job', routine: false });
  });

  it('hides a job that finished and moved nothing, unless asked for all', async () => {
    const h = await harness();
    const source = await makeDir();
    await put(join(source, 'Dune.2021.mkv'));
    const analysed = await submit(h, source);
    await h.app.jobs.idle();

    expect(await view(h)).toEqual({ total: 0, items: [] });
    const all = await view(h, '?all=true');
    expect(all.total).toBe(1);
    expect(all.items[0]).toMatchObject({
      id: analysed,
      kind: 'job',
      status: 'done',
      routine: true,
    });
    // Hiding is a view: the job is still there.
    expect((await h.request('GET', `/api/jobs/${analysed}`)).statusCode).toBe(200);
  });

  it('counts the lines of the view and pages them together', async () => {
    const h = await harness();
    await submit(h, '/no/such/one');
    await submit(h, '/no/such/two');
    await h.app.jobs.idle();
    const { batchId } = await run(h);

    const first = await view(h, '?limit=2');
    expect(first.total).toBe(3);
    expect(first.items[0]?.id).toBe(batchId);
    expect((await view(h, '?limit=2&offset=2')).items).toHaveLength(1);
  });
});
