import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EntryStore } from '../src/entries.js';
import {
  cleanup,
  fakeProvider,
  harness,
  batchOf,
  jobEntries,
  librariesAt,
  makeDir,
  put,
} from './harness.js';

afterEach(cleanup);

const DUNE = { kind: 'movie', id: { provider: 'tmdb', id: 438631 }, title: 'Dune', year: 2021 };

/** A queue holding one file the provider cannot read, under a profile that writes an NFO. */
async function setup(options: { detailsFail?: boolean } = {}) {
  const destination = await makeDir();
  const h = await harness({
    config: { libraries: [...librariesAt(destination)], naming: 'no-id', metadata: 'nfo' },
    createProvider: () => ({
      ...fakeProvider,
      ...(options.detailsFail && {
        getMovieDetails: () => Promise.reject(new Error('tmdb is down')),
      }),
    }),
  });
  const source = await makeDir();
  const file = await put(join(source, 'Mystery.Home.Video.mkv'));
  const created = await h.request('POST', '/api/jobs', { path: source });
  const jobId = created.json<{ id: string }>().id;
  await h.app.jobs.idle();
  const [entry] = jobEntries<{ id: string }>(h, jobId);
  return { h, destination, jobId, entryId: entry?.id ?? '', file };
}

describe('metadata files in the validation queue', () => {
  it('plans the NFO of a file a human matched', async () => {
    const { h, destination, entryId } = await setup();
    const matched = await h.match(entryId, DUNE);
    expect(matched.statusCode).toBe(200);

    // What the transfer will run, as stored on the file: nothing is written yet.
    const operations = new EntryStore(h.database).get(entryId)?.item?.operations ?? [];
    expect(operations.map((op) => op.type)).toEqual(
      expect.arrayContaining(['transfer', 'write-file']),
    );
    expect(operations.find((op) => op.type === 'write-file')?.destination).toBe(
      join(destination, 'Dune (2021)', 'movie.nfo'),
    );
  });

  it('still previews when the details cannot be fetched, but refuses to match', async () => {
    const { destination, h, entryId } = await setup({ detailsFail: true });
    const preview = await h.request('POST', `/api/entries/${entryId}/preview`, DUNE);
    expect(preview.statusCode).toBe(200);
    expect(preview.json<{ destination: string }>().destination).toBe(
      join(destination, 'Dune (2021)', 'Dune (2021).mkv'),
    );

    const matched = await h.match(entryId, DUNE);
    expect(matched.statusCode).toBeGreaterThanOrEqual(500);
    // Nothing was recorded: the file is still waiting for a decision.
    const waiting = (await h.request('GET', '/api/arrivals')).json<{ items: { id: string }[] }>();
    expect(waiting.items.map((e) => e.id)).toEqual([entryId]);
  });

  it('lists the NFO written for a file a human matched in its batch', async () => {
    const { h, destination, jobId, entryId } = await setup();
    await h.match(entryId, DUNE);
    const nfo = join(destination, 'Dune (2021)', 'movie.nfo');

    const execution = (await h.request('POST', `/api/plans/${jobId}/execute`)).json<{
      id: string;
    }>();
    await h.app.jobs.idle();
    const batchId = batchOf(h, execution.id);
    const batch = (await h.request('GET', `/api/batches/${batchId}`)).json<{
      items: unknown[];
      extras: unknown[];
    }>();
    expect(batch.items).toHaveLength(1);
    expect(batch.extras).toEqual([{ kind: 'generated', destination: nfo }]);
  });
});
