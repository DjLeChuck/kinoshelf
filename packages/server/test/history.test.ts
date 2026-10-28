import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteJournal } from '@kinoshelf/core';
import { cleanup, harness, makeDir, put, type Harness } from './harness.js';

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
  const { batchId } = (await h.request('GET', `/api/executions/${execution.id}`)).json<{
    batchId: string;
  }>();
  return { source, batchId };
}

const list = async (h: Harness, query = ''): Promise<BatchBody[]> =>
  (await h.request('GET', `/api/batches${query}`)).json<BatchBody[]>();

describe('GET /api/batches', () => {
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
      origin: { path: source },
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
      id: 'x1',
      batchId: 'from-cli',
      source: '/a.mkv',
      destination: '/b.mkv',
      mode: 'move',
      createdDirectories: [],
      at: '2026-10-28T08:00:00.000Z',
    });
    expect(await list(h)).toEqual([
      expect.objectContaining({ id: 'from-cli', origin: null, modes: ['move'], status: 'done' }),
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
