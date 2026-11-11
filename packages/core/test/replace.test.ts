import { Database } from '../src/index.js';
import { readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MemoryJournal,
  SqliteJournal,
  replaceImage,
  undoBatch,
  type Journal,
} from '../src/index.js';
import { replaceAtomic, writeAtomic } from '../src/execution/fs-ops.js';
import { cleanup, makeDir, put } from './workspace.js';

afterEach(cleanup);

const read = (path: string): Promise<string> => readFile(path, 'utf8');

async function setup(journal: Journal) {
  const dir = await makeDir();
  const backupDir = join(await makeDir(), 'replaced');
  const replace = (name: string, data: string, source = 'https://image.test/a.jpg', batch = 'b1') =>
    replaceImage({
      journal,
      batchId: batch,
      destination: join(dir, name),
      data: Buffer.from(data),
      source,
      backupDir,
    });
  return { dir, backupDir, replace };
}

describe.each([
  ['MemoryJournal', () => new MemoryJournal()],
  ['SqliteJournal', () => new SqliteJournal(new Database(':memory:'))],
])('replacing an image (%s)', (_name, make) => {
  it('writes a new image as an ordinary download, with nothing to keep', async () => {
    const journal = make();
    const { dir, backupDir, replace } = await setup(journal);
    const entry = await replace('poster.jpg', 'new');

    expect(entry.kind).toBe('downloaded');
    expect(await read(join(dir, 'poster.jpg'))).toBe('new');
    expect(journal.madeFileSource(join(dir, 'poster.jpg'))).toBe('https://image.test/a.jpg');
    await expect(readdir(backupDir)).rejects.toThrow();
  });

  it('keeps the file it replaces and journals where', async () => {
    const journal = make();
    const { dir, backupDir, replace } = await setup(journal);
    await put(join(dir, 'poster.jpg'), 'old');
    const entry = await replace('poster.jpg', 'new', 'https://image.test/b.jpg');

    expect(entry.kind).toBe('replaced');
    expect(await read(join(dir, 'poster.jpg'))).toBe('new');
    const [backup] = await readdir(backupDir);
    expect(await read(join(backupDir, backup ?? ''))).toBe('old');
    expect(journal.entriesOf('b1')[0]).toMatchObject({
      kind: 'replaced',
      source: 'https://image.test/b.jpg',
      backup: join(backupDir, backup ?? ''),
    });
    // It counts as a file Kinoshelf made, so a move cleaning a folder can tell it from the user's.
    expect(journal.madeFileIdentity(join(dir, 'poster.jpg'))).toBeDefined();
  });

  it('leaves no backup and keeps the file when the write fails', async () => {
    const journal = make();
    const { dir, backupDir } = await setup(journal);
    await put(join(dir, 'poster.jpg'), 'old');
    // A directory where the temporary file must go: the write cannot succeed.
    await expect(
      replaceImage({
        journal,
        batchId: 'b1',
        destination: join(dir, 'poster.jpg'),
        data: Buffer.from('new'),
        source: 'x',
        backupDir: join(dir, 'poster.jpg', 'nope'),
      }),
    ).rejects.toThrow();
    expect(await read(join(dir, 'poster.jpg'))).toBe('old');
    expect(journal.hasBatches()).toBe(false);
    await expect(readdir(backupDir)).rejects.toThrow();
  });

  it('brings the old image back when the batch is undone, and the image before it after that', async () => {
    const journal = make();
    const { dir, replace } = await setup(journal);
    const file = join(dir, 'poster.jpg');
    await replace('poster.jpg', 'first', 'https://image.test/1.jpg', 'b1');
    await replace('poster.jpg', 'second', 'https://image.test/2.jpg', 'b2');
    expect(journal.madeFileSource(file)).toBe('https://image.test/2.jpg');

    const undone = await undoBatch(journal, 'b2');
    expect(undone?.entries[0]?.status).toBe('undone');
    expect(await read(file)).toBe('first');
    expect(journal.madeFileSource(file)).toBe('https://image.test/1.jpg');

    await undoBatch(journal, 'b1');
    await expect(readFile(file)).rejects.toThrow();
  });

  it('keeps an image changed since the replacement', async () => {
    const journal = make();
    const { dir, replace } = await setup(journal);
    const file = join(dir, 'poster.jpg');
    await put(file, 'old');
    await replace('poster.jpg', 'new');
    await writeFile(file, 'edited by hand');
    await utimes(file, new Date(0), new Date(0));

    const undone = await undoBatch(journal, 'b1');
    expect(undone?.entries[0]).toMatchObject({
      status: 'skipped',
      error: { code: 'undo.destination-changed' },
    });
    expect(await read(file)).toBe('edited by hand');
  });

  it('says so when the old image is no longer kept, and leaves the new one', async () => {
    const journal = make();
    const { dir, backupDir, replace } = await setup(journal);
    await put(join(dir, 'poster.jpg'), 'old');
    await replace('poster.jpg', 'new');
    const [backup] = await readdir(backupDir);
    await writeFile(join(backupDir, backup ?? ''), 'x');
    await import('node:fs/promises').then(({ unlink }) => unlink(join(backupDir, backup ?? '')));

    const undone = await undoBatch(journal, 'b1');
    expect(undone?.entries[0]).toMatchObject({
      status: 'skipped',
      error: { code: 'undo.backup-missing' },
    });
    expect(await read(join(dir, 'poster.jpg'))).toBe('new');
  });

  it('only previews a replacement on a dry run', async () => {
    const journal = make();
    const { dir, replace } = await setup(journal);
    await put(join(dir, 'poster.jpg'), 'old');
    await replace('poster.jpg', 'new');
    await undoBatch(journal, 'b1', { dryRun: true });
    expect(await read(join(dir, 'poster.jpg'))).toBe('new');
  });
});

describe('the pipeline still never overwrites', () => {
  it('writeAtomic refuses a file that is there, replaceAtomic is the one that does not', async () => {
    const dir = await makeDir();
    const file = await put(join(dir, 'poster.jpg'), 'old');
    await expect(writeAtomic(file, 'new')).rejects.toMatchObject({
      info: { code: 'destination.exists' },
    });
    expect(await read(file)).toBe('old');
    await replaceAtomic(file, Buffer.from('new'));
    expect(await read(file)).toBe('new');
    expect(await readdir(dir)).toEqual(['poster.jpg']);
  });
});

describe('the SQLite journal', () => {
  it('keeps the backup of a replacement across a reopening', async () => {
    const sqlite = new Database(':memory:');
    const first = new SqliteJournal(sqlite);
    const { replace, dir } = await setup(first);
    await put(join(dir, 'poster.jpg'), 'old');
    await replace('poster.jpg', 'new');
    const [stored] = new SqliteJournal(sqlite).entriesOf('b1');
    expect(stored).toMatchObject({ kind: 'replaced' });
    expect(stored?.kind === 'replaced' && stored.backup).toContain('replaced');
  });
});
