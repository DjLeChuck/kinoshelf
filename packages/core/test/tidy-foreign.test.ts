import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryJournal, tidyForeignFiles, undoBatch, type TidyLibrary } from '../src/index.js';
import { cleanup, makeDir, put } from './workspace.js';

afterEach(cleanup);

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

async function setup(files: Record<string, string>, journal = new MemoryJournal()) {
  const library: TidyLibrary = { id: 'films', type: 'movie', source: await makeDir() };
  const folder = join(library.source, 'Dune (2021)');
  await put(join(folder, 'Dune (2021).mkv'), 'video');
  for (const [name, content] of Object.entries(files)) {
    await put(join(folder, name), content);
  }
  return { library, folder, journal, backupDir: await makeDir() };
}

const run = (
  s: Awaited<ReturnType<typeof setup>>,
  extra: { dryRun?: boolean; includeNfo?: boolean } = {},
) =>
  tidyForeignFiles(s.library, {
    journal: s.journal,
    backupDir: s.backupDir,
    dryRun: extra.dryRun ?? false,
    ...(extra.includeNfo !== undefined && { includeNfo: extra.includeNfo }),
  });

describe('tidyForeignFiles', () => {
  it('renames an image to Kinoshelf’s name when that one is not there, and undo renames it back', async () => {
    const s = await setup({ 'Dune (2021)-poster.jpg': 'poster' });

    const { batchId, files } = await run(s);

    expect(files).toMatchObject([{ action: 'rename', status: 'done', counterpart: 'poster.jpg' }]);
    expect(await readFile(join(s.folder, 'poster.jpg'), 'utf8')).toBe('poster');
    expect(await exists(join(s.folder, 'Dune (2021)-poster.jpg'))).toBe(false);

    await undoBatch(s.journal, batchId ?? '');
    expect(await exists(join(s.folder, 'Dune (2021)-poster.jpg'))).toBe(true);
    expect(await exists(join(s.folder, 'poster.jpg'))).toBe(false);
  });

  it('takes the image aside when Kinoshelf’s is already there, and undo brings it back', async () => {
    const s = await setup({ 'Dune (2021)-fanart.jpg': 'theirs', 'fanart.jpg': 'ours' });

    const { batchId, files } = await run(s);

    expect(files).toMatchObject([{ action: 'remove', status: 'done' }]);
    expect(await readFile(join(s.folder, 'fanart.jpg'), 'utf8')).toBe('ours');
    expect(await exists(join(s.folder, 'Dune (2021)-fanart.jpg'))).toBe(false);

    await undoBatch(s.journal, batchId ?? '');
    expect(await readFile(join(s.folder, 'Dune (2021)-fanart.jpg'), 'utf8')).toBe('theirs');
  });

  it('never renames over an image of the other format', async () => {
    const s = await setup({ 'Dune (2021)-poster.png': 'png' });

    const { files } = await run(s);

    expect(files).toMatchObject([{ status: 'skipped', reason: 'format' }]);
    expect(await exists(join(s.folder, 'Dune (2021)-poster.png'))).toBe(true);
  });

  it('leaves the NFO unless asked, then takes it aside only beside a movie.nfo', async () => {
    const s = await setup({ 'Dune (2021).nfo': 'theirs', 'movie.nfo': 'ours' });

    expect((await run(s)).files).toMatchObject([
      { status: 'skipped', reason: 'nfo-not-requested' },
    ]);
    expect((await run(s, { includeNfo: true })).files).toMatchObject([
      { action: 'remove', status: 'done' },
    ]);
    expect(await exists(join(s.folder, 'Dune (2021).nfo'))).toBe(false);
    expect(await readFile(join(s.folder, 'movie.nfo'), 'utf8')).toBe('ours');
  });

  it('leaves an NFO when there is no movie.nfo, or when the folder holds several videos', async () => {
    const alone = await setup({ 'Dune (2021).nfo': 'theirs' });
    expect((await run(alone, { includeNfo: true })).files).toMatchObject([
      { reason: 'no-counterpart' },
    ]);

    const versions = await setup({ 'Dune (2021).nfo': 'theirs', 'movie.nfo': 'ours' });
    await put(join(versions.folder, 'Dune (2021) - 2160p.mkv'), 'video');
    expect((await run(versions, { includeNfo: true })).files).toMatchObject([
      { reason: 'versions' },
    ]);
    expect(await exists(join(versions.folder, 'Dune (2021).nfo'))).toBe(true);
  });

  it('leaves a file Kinoshelf’s journal made', async () => {
    const s = await setup({ 'Dune (2021)-poster.jpg': 'poster' });
    const path = join(s.folder, 'Dune (2021)-poster.jpg');
    const { size, mtimeMs } = await stat(path);
    s.journal.record({
      id: 'e',
      batchId: 'b',
      kind: 'downloaded',
      source: 'https://x',
      destination: path,
      createdDirectories: [],
      at: new Date().toISOString(),
      identity: { size, mtimeMs },
    });

    expect((await run(s)).files).toMatchObject([{ status: 'skipped', reason: 'ours' }]);
  });

  it('only reports in a dry run', async () => {
    const s = await setup({ 'Dune (2021)-poster.jpg': 'poster' });

    const { batchId, files } = await run(s, { dryRun: true });

    expect(batchId).toBeNull();
    expect(files).toMatchObject([{ action: 'rename', status: 'would-do' }]);
    expect(await exists(join(s.folder, 'poster.jpg'))).toBe(false);
    expect(s.journal.hasBatches()).toBe(false);
  });
});
