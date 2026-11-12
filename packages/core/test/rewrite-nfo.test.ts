import { readFile, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Database,
  MemoryJournal,
  SqliteJournal,
  rewriteNfo,
  undoBatch,
  type Journal,
} from '../src/index.js';
import { cleanup, makeDir, put } from './workspace.js';
import { stat } from 'node:fs/promises';

afterEach(cleanup);

const read = (path: string): Promise<string> => readFile(path, 'utf8');

/** An NFO as the executor leaves it: on the disk and journaled as generated, identity included. */
async function written(journal: Journal, content: string) {
  const dir = await makeDir();
  const backupDir = join(await makeDir(), 'replaced');
  const destination = join(dir, 'movie.nfo');
  await put(destination, content);
  const { size, mtimeMs } = await stat(destination);
  journal.record({
    id: 'e0',
    batchId: 'b0',
    kind: 'generated',
    source: '',
    destination,
    createdDirectories: [],
    at: new Date().toISOString(),
    identity: { size, mtimeMs },
  });
  const rewrite = (next: string, batchId = 'b1') =>
    rewriteNfo({ journal, batchId, destination, content: next, backupDir });
  return { destination, rewrite };
}

describe.each([
  ['MemoryJournal', () => new MemoryJournal()],
  ['SqliteJournal', () => new SqliteJournal(new Database(':memory:'))],
])('rewriting an NFO (%s)', (_name, make) => {
  it('replaces an NFO Kinoshelf wrote and keeps the old one for undo', async () => {
    const journal = make();
    const { destination, rewrite } = await written(journal, '<movie>old</movie>');

    expect(await rewrite('<movie>new</movie>')).toBe('rewritten');
    expect(await read(destination)).toBe('<movie>new</movie>');
    expect(journal.entriesOf('b1')[0]).toMatchObject({ kind: 'replaced', destination });

    const undone = await undoBatch(journal, 'b1');
    expect(undone?.entries.every((e) => e.status === 'undone')).toBe(true);
    expect(await read(destination)).toBe('<movie>old</movie>');
  });

  it('can be rewritten again: a rewritten NFO is still one Kinoshelf made', async () => {
    const journal = make();
    const { destination, rewrite } = await written(journal, 'a');
    expect(await rewrite('b', 'b1')).toBe('rewritten');
    expect(await rewrite('c', 'b2')).toBe('rewritten');
    expect(await read(destination)).toBe('c');
  });

  it('leaves an NFO that someone edited since', async () => {
    const journal = make();
    const { destination, rewrite } = await written(journal, '<movie>old</movie>');
    await writeFile(destination, '<movie>by hand, and longer</movie>');
    await utimes(destination, new Date(), new Date(Date.now() + 5000));

    expect(await rewrite('<movie>new</movie>')).toBe('kept');
    expect(await read(destination)).toBe('<movie>by hand, and longer</movie>');
    expect(journal.entriesOf('b1')).toEqual([]);
  });

  it('leaves an NFO Kinoshelf never wrote', async () => {
    const journal = make();
    const dir = await makeDir();
    const destination = join(dir, 'movie.nfo');
    await put(destination, 'mine');
    const result = await rewriteNfo({
      journal,
      batchId: 'b1',
      destination,
      content: 'new',
      backupDir: join(dir, 'replaced'),
    });
    expect(result).toBe('kept');
    expect(await read(destination)).toBe('mine');
  });

  it('touches nothing when the NFO already says it, and reports a missing one', async () => {
    const journal = make();
    const { destination, rewrite } = await written(journal, 'same');
    expect(await rewrite('same')).toBe('unchanged');
    expect(journal.entriesOf('b1')).toEqual([]);

    const missing = await rewriteNfo({
      journal,
      batchId: 'b1',
      destination: join(destination, '..', 'absent.nfo'),
      content: 'x',
      backupDir: join(destination, '..', 'replaced'),
    });
    expect(missing).toBe('missing');
  });
});
