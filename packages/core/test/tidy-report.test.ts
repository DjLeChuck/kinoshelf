import { mkdir, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tidyReport, type TidyLibrary } from '../src/index.js';
import { cleanup, makeDir, put } from './workspace.js';

afterEach(cleanup);

const movies = async (): Promise<TidyLibrary> => ({
  id: 'films',
  type: 'movie',
  source: await makeDir(),
});
const shows = async (): Promise<TidyLibrary> => ({
  id: 'series',
  type: 'series',
  source: await makeDir(),
});

/** A tree as a sorted list of paths, to show a report leaves the disk as it found it. */
async function listing(root: string): Promise<string[]> {
  return (await readdir(root, { recursive: true })).sort();
}

describe('tidyReport: folders with no video', () => {
  it('lists a movie folder holding only metadata, with what is in it', async () => {
    const library = await movies();
    await put(join(library.source, 'Dune (2021)', 'Dune (2021).mkv'), 'video');
    await put(join(library.source, 'Alien (1979)', 'movie.nfo'), 'nfo');
    await put(join(library.source, 'Alien (1979)', 'poster.jpg'), 'poster');

    const report = await tidyReport(library);

    expect(report.orphanFolders).toEqual([
      {
        path: join(library.source, 'Alien (1979)'),
        files: 2,
        sizeBytes: 9,
        entries: ['movie.nfo', 'poster.jpg'],
        otherFiles: 0,
      },
    ]);
  });

  it('lists an empty folder', async () => {
    const library = await movies();
    await mkdir(join(library.source, 'Empty (2000)'));

    const { orphanFolders } = await tidyReport(library);

    expect(orphanFolders).toMatchObject([{ files: 0, entries: [], sizeBytes: 0 }]);
  });

  it('flags the files that are neither an NFO, an image nor a subtitle', async () => {
    const library = await movies();
    await put(join(library.source, 'Film (2000)', 'movie.nfo'), 'nfo');
    await put(join(library.source, 'Film (2000)', 'Film.mkv.part'), 'half');
    await put(join(library.source, 'Film (2000)', 'Subs', 'fr.srt'), 'sub');

    const { orphanFolders } = await tidyReport(library);

    expect(orphanFolders).toMatchObject([
      { files: 3, otherFiles: 1, entries: ['Film.mkv.part', 'movie.nfo', 'Subs/', 'Subs/fr.srt'] },
    ]);
  });

  it('never lists a folder below a work that has a video (Subs, Extras)', async () => {
    const library = await movies();
    await put(join(library.source, 'Dune (2021)', 'Dune (2021).mkv'));
    await put(join(library.source, 'Dune (2021)', 'Subs', 'fr.srt'));
    await mkdir(join(library.source, 'Dune (2021)', 'Extras'));

    expect((await tidyReport(library)).orphanFolders).toEqual([]);
  });

  it('is decided by the video anywhere below, not by the folder’s own files', async () => {
    const library = await movies();
    await put(join(library.source, 'Film (2000)', 'Video', 'Film.mkv'));

    expect((await tidyReport(library)).orphanFolders).toEqual([]);
  });

  it('reads a video by its extension, whatever the case', async () => {
    const library = await movies();
    await put(join(library.source, 'Film (2000)', 'FILM.MKV'));

    expect((await tidyReport(library)).orphanFolders).toEqual([]);
  });

  it('lists an empty season of a series but not the show that has videos', async () => {
    const library = await shows();
    await put(join(library.source, 'Show', 'Season 01', 'Show - s01e01.mkv'));
    await mkdir(join(library.source, 'Show', 'Season 02'));
    await put(join(library.source, 'Gone', 'tvshow.nfo'));

    const { orphanFolders } = await tidyReport(library);

    expect(orphanFolders.map(({ path }) => path)).toEqual([
      join(library.source, 'Gone'),
      join(library.source, 'Show', 'Season 02'),
    ]);
  });

  it('reports the top folder only, not the ones inside it', async () => {
    const library = await shows();
    await put(join(library.source, 'Gone', 'Season 01', 'poster.jpg'));

    const { orphanFolders } = await tidyReport(library);

    expect(orphanFolders.map(({ path }) => path)).toEqual([join(library.source, 'Gone')]);
  });

  it('does not go deeper than a movie folder, nor a season', async () => {
    const movie = await movies();
    await put(join(movie.source, 'Collection', 'Film.mkv'));
    await mkdir(join(movie.source, 'Collection', 'Empty'));
    expect((await tidyReport(movie)).orphanFolders).toEqual([]);

    const series = await shows();
    await put(join(series.source, 'Show', 'Season 01', 'e01.mkv'));
    await mkdir(join(series.source, 'Show', 'Season 01', 'Extras'));
    expect((await tidyReport(series)).orphanFolders).toEqual([]);
  });

  it('skips the folders a NAS or a file system keeps', async () => {
    const library = await movies();
    for (const name of ['@eaDir', '#recycle', 'lost+found', '.hidden']) {
      await put(join(library.source, name, 'x.jpg'));
    }

    expect((await tidyReport(library)).orphanFolders).toEqual([]);
  });

  it('cannot call a folder empty of videos when a link is in it', async () => {
    const library = await movies();
    const elsewhere = await makeDir();
    await put(join(elsewhere, 'Film.mkv'));
    await mkdir(join(library.source, 'Film (2000)'));
    await symlink(join(elsewhere, 'Film.mkv'), join(library.source, 'Film (2000)', 'Film.mkv'));

    expect((await tidyReport(library)).orphanFolders).toEqual([]);
  });

  it('caps the names it lists but counts every file', async () => {
    const library = await movies();
    for (let index = 0; index < 25; index++) {
      await put(join(library.source, 'Film (2000)', `${String(index).padStart(2, '0')}.jpg`));
    }

    const [folder] = (await tidyReport(library)).orphanFolders;

    expect(folder?.files).toBe(25);
    expect(folder?.entries).toHaveLength(20);
  });

  it('fails on a source that does not exist', async () => {
    const library = await movies();

    await expect(
      tidyReport({ ...library, source: join(library.source, 'nope') }),
    ).rejects.toMatchObject({
      info: { code: 'discover.not-found' },
    });
  });

  it('changes nothing on the disk', async () => {
    const library = await movies();
    await put(join(library.source, 'Alien (1979)', 'movie.nfo'));
    await put(join(library.source, 'Dune (2021)', 'Dune (2021).mkv'));
    await put(join(library.source, 'Dune (2021)', 'Dune (2021)-poster.jpg'));
    const before = await listing(library.source);

    await tidyReport(library);

    expect(await listing(library.source)).toEqual(before);
  });
});

describe('tidyReport: metadata named after the video', () => {
  const NAME = 'Projet Dernière Chance (2026)';

  it('finds what another tool wrote beside a movie, and says what Kinoshelf writes instead', async () => {
    const library = await movies();
    const folder = join(library.source, NAME);
    await put(join(folder, `${NAME}.mkv`), 'video');
    await put(join(folder, `${NAME}.nfo`), 'nfo');
    await put(join(folder, `${NAME}-poster.jpg`), 'poster');
    await put(join(folder, `${NAME}-fanart.jpg`), 'fanart');
    await put(join(folder, `${NAME}-clearlogo.png`), 'logo');

    const { foreignFiles } = await tidyReport(library);

    expect(
      foreignFiles.map(({ kind, counterpart, counterpartPresent }) => [
        kind,
        counterpart,
        counterpartPresent,
      ]),
    ).toEqual([
      ['logo', 'clearlogo.png', false],
      ['fanart', 'fanart.jpg', false],
      ['poster', 'poster.jpg', false],
      ['nfo', 'movie.nfo', false],
    ]);
    expect(foreignFiles.every(({ path }) => path.startsWith(folder))).toBe(true);
  });

  it('says when the profile’s own file is already there, which makes removing the other safe', async () => {
    const library = await movies();
    const folder = join(library.source, NAME);
    await put(join(folder, `${NAME}.mkv`));
    await put(join(folder, `${NAME}-poster.jpg`));
    await put(join(folder, 'poster.jpg'));

    const { foreignFiles } = await tidyReport(library);

    expect(foreignFiles).toMatchObject([{ kind: 'poster', counterpartPresent: true }]);
  });

  it('does not take the profile’s own names for foreign ones', async () => {
    const library = await movies();
    const folder = join(library.source, NAME);
    await put(join(folder, `${NAME}.mkv`));
    for (const name of ['movie.nfo', 'poster.jpg', 'fanart.jpg', 'clearlogo.png']) {
      await put(join(folder, name));
    }

    expect((await tidyReport(library)).foreignFiles).toEqual([]);
  });

  it('keeps `movie.nfo` its own even for a video named `movie`', async () => {
    const library = await movies();
    await put(join(library.source, 'X (2000)', 'movie.mkv'));
    await put(join(library.source, 'X (2000)', 'movie.nfo'));

    expect((await tidyReport(library)).foreignFiles).toEqual([]);
  });

  it('ignores files named after another video than the ones in the folder', async () => {
    const library = await movies();
    const folder = join(library.source, NAME);
    await put(join(folder, `${NAME}.mkv`));
    await put(join(folder, 'Other (2000)-poster.jpg'));

    expect((await tidyReport(library)).foreignFiles).toEqual([]);
  });

  it('does not look in a series library, where the NFO and thumbnail are named after the video', async () => {
    const library = await shows();
    const folder = join(library.source, 'Show', 'Season 01');
    await put(join(folder, 'Show - s01e01.mkv'));
    await put(join(folder, 'Show - s01e01.nfo'));
    await put(join(folder, 'Show - s01e01-thumb.jpg'));

    expect((await tidyReport(library)).foreignFiles).toEqual([]);
  });
});
