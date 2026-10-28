import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPlan,
  executePlan,
  loadProfileFile,
  MemoryJournal,
  undoLastBatch,
  type TransferMode,
} from '../src/index.js';
import { movie } from './fake-provider.js';
import { cleanup, counter, makeDir, parsedMovie, put } from './workspace.js';

const plex = await loadProfileFile(new URL('../../../profiles/plex.yaml', import.meta.url));
const FOLDER = 'Dune (2021) {tmdb-438631}';
const STEM = 'Dune (2021) {tmdb-438631}';

afterEach(cleanup);

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

/** Imports one movie with the given mode and returns everything needed to inspect the result. */
async function importMovie(
  mode: TransferMode,
  journal = new MemoryJournal(),
  options: {
    src?: string;
    lib?: string;
    name?: string;
    id?: number;
    title?: string;
    sidecar?: boolean;
  } = {},
) {
  const src = options.src ?? (await makeDir());
  const lib = options.lib ?? (await makeDir());
  const source = await put(join(src, 'sub', options.name ?? 'Dune.2021.mkv'), 'video');
  if (options.sidecar) {
    await put(join(src, 'sub', 'Dune.2021.srt'), 'subs');
  }
  const candidate = movie(options.id ?? 438631, options.title ?? 'Dune', 2021);
  const plan = await createPlan([{ parsed: parsedMovie(source), candidate }], {
    profile: plex,
    destinationRoot: lib,
    mode,
  });
  const batch = await executePlan(plan, { journal, newId: counter(`b${options.id ?? 1}-`) });
  return { src, lib, source, journal, batch };
}

describe('undoLastBatch', () => {
  it('has nothing to undo on an empty journal', async () => {
    expect(await undoLastBatch(new MemoryJournal())).toBeNull();
  });

  it('removes a copy and the directories it created, keeping the source', async () => {
    const { lib, source, journal } = await importMovie('copy', undefined, { sidecar: true });
    const result = await undoLastBatch(journal);

    expect(result?.entries.map((e) => e.status)).toEqual(['undone', 'undone']);
    expect(await readdir(lib)).toEqual([]); // the library root itself is left alone
    expect(await readFile(source, 'utf8')).toBe('video');
    expect(journal.lastBatchId()).toBeNull();
  });

  it('keeps a pre-existing directory and a directory that is no longer empty', async () => {
    const lib = await makeDir();
    await put(join(lib, FOLDER, 'keep.txt'), 'mine');
    const { journal } = await importMovie('copy', undefined, { lib });
    await undoLastBatch(journal);
    expect(await readdir(join(lib, FOLDER))).toEqual(['keep.txt']);

    const lib2 = await makeDir();
    const second = await importMovie('copy', undefined, { lib: lib2 });
    await writeFile(join(lib2, FOLDER, 'added-later.txt'), 'user file');
    await undoLastBatch(second.journal);
    expect(await readdir(join(lib2, FOLDER))).toEqual(['added-later.txt']);
  });

  it('drops a hardlink without harming the source', async () => {
    const { lib, source, journal } = await importMovie('hardlink');
    await undoLastBatch(journal);
    expect(await exists(join(lib, FOLDER, `${STEM}.mkv`))).toBe(false);
    expect(await readFile(source, 'utf8')).toBe('video');
    expect((await stat(source)).nlink).toBe(1);
  });

  it('puts a moved file back, recreating its folder if it is gone', async () => {
    const { src, lib, source, journal } = await importMovie('move');
    expect(await exists(source)).toBe(false);
    await rm(join(src, 'sub'), { recursive: true });

    const result = await undoLastBatch(journal);

    expect(result?.entries[0]?.status).toBe('undone');
    expect(await readFile(source, 'utf8')).toBe('video');
    expect(await exists(join(lib, FOLDER))).toBe(false);
  });

  it('does not put a moved file back over something that took its place', async () => {
    const { lib, source, journal } = await importMovie('move');
    await put(source, 'newcomer');

    const result = await undoLastBatch(journal);

    expect(result?.entries[0]).toMatchObject({
      status: 'skipped',
      error: { code: 'undo.source-exists' },
    });
    expect(await readFile(source, 'utf8')).toBe('newcomer');
    expect(await exists(join(lib, FOLDER, `${STEM}.mkv`))).toBe(true);
  });

  it('skips what was already removed', async () => {
    const { lib, journal } = await importMovie('copy');
    await rm(join(lib, FOLDER, `${STEM}.mkv`));
    const result = await undoLastBatch(journal);
    expect(result?.entries[0]).toMatchObject({
      status: 'skipped',
      error: { code: 'undo.destination-missing' },
    });
  });

  it('undoes one batch at a time, most recent first', async () => {
    const journal = new MemoryJournal();
    const lib = await makeDir();
    const first = await importMovie('copy', journal, { lib, id: 1, title: 'Alpha', name: 'a.mkv' });
    const second = await importMovie('copy', journal, { lib, id: 2, title: 'Beta', name: 'b.mkv' });

    expect((await undoLastBatch(journal))?.batchId).toBe(second.batch.batchId);
    expect(await exists(join(lib, 'Beta (2021) {tmdb-2}'))).toBe(false);
    expect(await exists(join(lib, 'Alpha (2021) {tmdb-1}'))).toBe(true);

    expect((await undoLastBatch(journal))?.batchId).toBe(first.batch.batchId);
    expect(await undoLastBatch(journal)).toBeNull();
  });

  it('changes nothing in a dry run and leaves the batch pending', async () => {
    const { lib, journal, batch } = await importMovie('copy');
    const result = await undoLastBatch(journal, { dryRun: true });

    expect(result).toMatchObject({ dryRun: true, batchId: batch.batchId });
    expect(result?.entries[0]?.status).toBe('undone');
    expect(await exists(join(lib, FOLDER, `${STEM}.mkv`))).toBe(true);
    expect(journal.lastBatchId()).toBe(batch.batchId);
  });

  it('leaves the batch pending when a revert fails, so it can be retried', async () => {
    const { src, journal, batch } = await importMovie('move');
    // The original folder is now a file: the move cannot go back.
    await rm(join(src, 'sub'), { recursive: true, force: true });
    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'sub'), 'blocker');

    const result = await undoLastBatch(journal);

    expect(result?.entries[0]?.status).toBe('failed');
    expect(journal.lastBatchId()).toBe(batch.batchId);

    await rm(join(src, 'sub'));
    expect((await undoLastBatch(journal))?.entries[0]?.status).toBe('undone');
    expect(journal.lastBatchId()).toBeNull();
  });
});
