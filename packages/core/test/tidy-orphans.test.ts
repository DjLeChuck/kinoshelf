import { writeFileSync } from 'node:fs';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MemoryJournal,
  removeOrphanFolders,
  twinKey,
  undoBatch,
  type TidyLibrary,
} from '../src/index.js';
import { cleanup, makeDir, put } from './workspace.js';

afterEach(cleanup);

const library = async (type: 'movie' | 'series' = 'movie'): Promise<TidyLibrary> => ({
  id: 'lib',
  type,
  source: await makeDir(),
});

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/** A movie in its renamed folder and the folder tinyMediaManager's name left behind. */
async function dressed(lib: TidyLibrary) {
  await put(join(lib.source, 'Dune (2021)', 'Dune (2021).mkv'), 'video');
  await put(join(lib.source, 'Dune (2021) - 1080p', 'Dune (2021)-poster.jpg'), 'poster');
  await put(join(lib.source, 'Dune (2021) - 1080p', 'Dune (2021).nfo'), 'nfo');
}

async function run(lib: TidyLibrary, dryRun = false) {
  const journal = new MemoryJournal();
  const backupDir = await makeDir();
  const result = await removeOrphanFolders(lib, { journal, backupDir, dryRun });
  return { journal, backupDir, result };
}

describe('twinKey', () => {
  it.each([
    ['Dune (2021) - 1080p', 'Dune (2021)'],
    ['Avatar : La Voie de l’eau (2022)', 'Avatar La Voie de l’eau (2022)'],
    ['Amélie (2001)', 'Amelie (2001)'],
    ['Season 1', 'Season 01'],
    ['Dune (2021) {tmdb-438631}', 'dune (2021)'],
  ])('reads %s and %s as one work', (a, b) => {
    expect(twinKey(a)).toBe(twinKey(b));
  });

  it('keeps two works of one title apart', () => {
    expect(twinKey('Dune (1984)')).not.toBe(twinKey('Dune (2021)'));
    expect(twinKey('Season 1')).not.toBe(twinKey('Season 10'));
  });
});

describe('removeOrphanFolders: twins by title and year', () => {
  async function pair(orphan: string, twin: string, ...others: string[]) {
    const lib = await library();
    await put(join(lib.source, twin, 'film.mkv'), 'video');
    for (const other of others) {
      await put(join(lib.source, other, 'film.mkv'), 'video');
    }
    await put(join(lib.source, orphan, 'poster.jpg'), 'poster');
    return run(lib);
  }

  it.each([
    ['Saw II - Unrated (2005) - 1080p', 'Saw II (2005)'],
    ['Dune - Première partie (2021) - 2160p', 'Dune (2021)'],
    [
      'Les Gardiens de la Galaxie - Volume 3 - IMAX (2023) - 2160p',
      'Les Gardiens de la Galaxie, volume 3 (2023)',
    ],
  ])('finds %s beside %s, and says it is approximate', async (orphan, twin) => {
    const { result } = await pair(orphan, twin);

    expect(result.folders).toMatchObject([{ status: 'removed', approximate: true }]);
  });

  it('keeps the exact twin exact', async () => {
    const { result } = await pair('Dune (2021) - 1080p', 'Dune (2021)');

    expect(result.folders[0]).not.toHaveProperty('approximate');
  });

  it('needs the same year', async () => {
    const { result } = await pair('Saw II - Unrated (2005)', 'Saw II (2006)');

    expect(result.folders).toMatchObject([{ status: 'skipped', reason: 'no-twin' }]);
  });

  it('takes the longest title, and no one when two are as good', async () => {
    const longest = await pair('Saw II - Unrated (2005)', 'Saw II (2005)', 'Saw (2005)');
    expect(longest.result.folders).toMatchObject([
      { status: 'removed', twin: expect.stringContaining('Saw II (2005)') as string },
    ]);

    const tied = await pair('Saw II - Unrated (2005)', 'Saw II (2005)', 'Saw II! (2005)');
    expect(tied.result.folders).toMatchObject([{ status: 'skipped', reason: 'no-twin' }]);
  });

  it('never makes a prefix of another film’s title a twin by itself', async () => {
    const { result } = await pair('Saw 3D - Chapitre final (2010)', 'Saw (2004)');

    expect(result.folders).toMatchObject([{ status: 'skipped', reason: 'no-twin' }]);
  });
});

describe('removeOrphanFolders', () => {
  it('takes a former tool’s folder out when its twin holds the video, keeping every file', async () => {
    const lib = await library();
    await dressed(lib);
    const { result, backupDir } = await run(lib);

    expect(result.folders).toMatchObject([
      { status: 'removed', files: 2, twin: join(lib.source, 'Dune (2021)') },
    ]);
    expect(await exists(join(lib.source, 'Dune (2021) - 1080p'))).toBe(false);
    expect(await exists(join(lib.source, 'Dune (2021)', 'Dune (2021).mkv'))).toBe(true);
    expect(await readdir(backupDir)).toHaveLength(2);
  });

  it('puts everything back, folder included, when the batch is undone', async () => {
    const lib = await library();
    await dressed(lib);
    const { result, journal } = await run(lib);

    const undone = await undoBatch(journal, result.batchId ?? '');

    expect(undone?.entries.map((e) => e.status)).toEqual(['undone', 'undone']);
    const folder = join(lib.source, 'Dune (2021) - 1080p');
    expect(await readFile(join(folder, 'Dune (2021)-poster.jpg'), 'utf8')).toBe('poster');
    expect(await readFile(join(folder, 'Dune (2021).nfo'), 'utf8')).toBe('nfo');
  });

  it('does not restore over a file that took the place since', async () => {
    const lib = await library();
    await dressed(lib);
    const { result, journal } = await run(lib);
    await put(join(lib.source, 'Dune (2021) - 1080p', 'Dune (2021).nfo'), 'new');

    const undone = await undoBatch(journal, result.batchId ?? '');

    expect(undone?.entries.map((e) => e.error?.code ?? e.status).sort()).toEqual([
      'undo.source-exists',
      'undone',
    ]);
    expect(await readFile(join(lib.source, 'Dune (2021) - 1080p', 'Dune (2021).nfo'), 'utf8')).toBe(
      'new',
    );
  });

  it('is a dry run when asked: nothing moves, nothing is journaled', async () => {
    const lib = await library();
    await dressed(lib);
    const { result, journal } = await run(lib, true);

    expect(result).toMatchObject({ batchId: null, folders: [{ status: 'would-remove' }] });
    expect(await exists(join(lib.source, 'Dune (2021) - 1080p', 'Dune (2021).nfo'))).toBe(true);
    expect(journal.hasBatches()).toBe(false);
  });

  it('leaves a folder no sibling with a video duplicates', async () => {
    const lib = await library();
    await put(join(lib.source, 'Alien (1979)', 'movie.nfo'), 'nfo');
    const { result } = await run(lib);

    expect(result.folders).toMatchObject([{ status: 'skipped', reason: 'no-twin' }]);
    expect(await exists(join(lib.source, 'Alien (1979)', 'movie.nfo'))).toBe(true);
  });

  it('leaves a folder beside another work’s, whatever the other one holds', async () => {
    const lib = await library();
    await put(join(lib.source, 'Dune (2021)', 'Dune (2021).mkv'), 'video');
    await put(join(lib.source, 'Alien (1979)', 'movie.nfo'), 'nfo');
    const { result } = await run(lib);

    expect(result.folders).toMatchObject([{ status: 'skipped', reason: 'no-twin' }]);
  });

  it('leaves a twin that holds no video itself', async () => {
    const lib = await library();
    await put(join(lib.source, 'Dune (2021)', 'movie.nfo'), 'nfo');
    await put(join(lib.source, 'Dune (2021) - 1080p', 'poster.jpg'), 'poster');
    const { result } = await run(lib);

    expect(result.folders.map((f) => f.reason)).toEqual(['no-twin', 'no-twin']);
  });

  it('leaves a folder holding something that is not metadata', async () => {
    const lib = await library();
    await dressed(lib);
    await put(join(lib.source, 'Dune (2021) - 1080p', 'notes.txt'), 'mine');
    const { result } = await run(lib);

    expect(result.folders).toMatchObject([{ status: 'skipped', reason: 'other-files' }]);
    expect(await exists(join(lib.source, 'Dune (2021) - 1080p', 'notes.txt'))).toBe(true);
  });

  it('removes a folder with no file at all, nested empty folders included, with no twin', async () => {
    const lib = await library();
    await put(join(lib.source, 'Dune (2021)', 'Dune (2021).mkv'), 'video');
    await mkdir(join(lib.source, 'Vide (2000)', 'Sub'), { recursive: true });
    const { result, journal } = await run(lib);

    expect(result.folders).toMatchObject([{ status: 'removed', empty: true, files: 0 }]);
    expect(await exists(join(lib.source, 'Vide (2000)'))).toBe(false);
    expect(result.batchId).toBeNull();
    expect(journal.hasBatches()).toBe(false);
  });

  it('only reports an empty folder in a dry run', async () => {
    const lib = await library();
    await mkdir(join(lib.source, 'Vide (2000)'));
    const { result } = await run(lib, true);

    expect(result.folders).toMatchObject([{ status: 'would-remove', empty: true }]);
    expect(await exists(join(lib.source, 'Vide (2000)'))).toBe(true);
  });

  it('takes a season folder out beside its renamed twin, sub-folders included', async () => {
    const lib = await library('series');
    const show = join(lib.source, 'The Bear (2022)');
    await put(join(show, 'Season 01', 'The Bear (2022) - s01e01.mkv'), 'video');
    await put(join(show, 'Season 1', 'e01-thumb.jpg'), 'thumb');
    await put(join(show, 'Season 1', 'Extras', 'x.jpg'), 'x');
    const { result, journal } = await run(lib);

    expect(result.folders).toMatchObject([{ status: 'removed', files: 2 }]);
    expect(await exists(join(show, 'Season 1'))).toBe(false);

    await undoBatch(journal, result.batchId ?? '');
    expect(await exists(join(show, 'Season 1', 'Extras', 'x.jpg'))).toBe(true);
  });

  it('keeps a folder that got a file while it was being emptied', async () => {
    const lib = await library();
    await dressed(lib);
    const folder = join(lib.source, 'Dune (2021) - 1080p');
    const journal = new MemoryJournal();
    // A download client writing into the folder as the files go.
    const record = journal.record.bind(journal);
    journal.record = (entry): void => {
      record(entry);
      writeFileSync(join(folder, 'late.jpg'), 'late');
    };
    await removeOrphanFolders(lib, { journal, backupDir: await makeDir(), dryRun: false });

    expect(await exists(join(folder, 'late.jpg'))).toBe(true);
  });
});
