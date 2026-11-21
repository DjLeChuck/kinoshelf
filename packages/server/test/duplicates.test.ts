import { link, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Database, type ParsedMedia } from '@kinoshelf/core';
import { afterEach, describe, expect, it } from 'vitest';
import { migrated } from '../src/database.js';
import { DuplicateFinder } from '../src/duplicates.js';
import type { Entry } from '../src/entries.js';
import { LibraryItemStore, type LibraryItem } from '../src/library-items.js';
import { cleanup, makeDir, put } from './harness.js';

afterEach(cleanup);

const row = (path: string, extra: Partial<LibraryItem>): LibraryItem => ({
  libraryId: 'films',
  path,
  kind: 'movie',
  tmdbId: 438631,
  title: 'Dune',
  year: 2021,
  season: null,
  episode: null,
  episodeEnd: null,
  state: 'ok',
  nfo: null,
  poster: null,
  fanart: null,
  logo: null,
  thumb: null,
  entryId: null,
  scanJobId: null,
  scannedAt: '2026-01-01T00:00:00.000Z',
  unavailable: [],
  picture: null,
  ...extra,
});

const arrival = (path: string, parsed: Partial<ParsedMedia> = {}): Entry =>
  ({ path, parsed: { path, kind: 'movie', episodes: [], ...parsed } }) as unknown as Entry;

async function setup() {
  const store = new LibraryItemStore(migrated(new Database(':memory:')));
  return {
    store,
    finder: new DuplicateFinder(store),
    library: await makeDir(),
    inbox: await makeDir(),
  };
}

describe('DuplicateFinder, for a movie', () => {
  it('tells a hardlink of a file of the library apart from a copy and another version', async () => {
    const { store, finder, library, inbox } = await setup();
    const there = await put(join(library, 'Dune (2021).mkv'), 'twenty-eight gigabytes');
    store.put(row(there, {}));

    const hardlink = join(inbox, 'Dune.2021.1080p.mkv');
    await link(there, hardlink);
    expect(await finder.verdict(arrival(hardlink), 'films', 438631)).toEqual({
      kind: 'same-file',
      path: there,
      libraryId: 'films',
      size: 22,
    });

    const copy = await put(join(inbox, 'Dune.copy.mkv'), 'twenty-eight gigabytes');
    expect(await finder.verdict(arrival(copy), 'films', 438631)).toMatchObject({
      kind: 'same-size',
      path: there,
      size: 22,
    });

    const other = await put(join(inbox, 'Dune.2021.2160p.mkv'), 'a much bigger remux of it');
    expect(await finder.verdict(arrival(other), 'films', 438631)).toEqual({
      kind: 'other-version',
      path: there,
      libraryId: 'films',
      size: null,
    });
  });

  it('says nothing for a work the library does not hold', async () => {
    const { store, finder, library, inbox } = await setup();
    store.put(row(await put(join(library, 'Dune (2021).mkv'), 'dune'), {}));
    const alien = await put(join(inbox, 'Alien.1979.mkv'), 'dune');
    expect(await finder.verdict(arrival(alien), 'films', 348)).toBeNull();
    // Another library is not the destination.
    expect(await finder.verdict(arrival(alien), 'uhd', 438631)).toBeNull();
  });

  it('ignores a library file nobody identified, and one that is gone', async () => {
    const { store, finder, library, inbox } = await setup();
    const stranger = await put(join(library, 'Mystery.mkv'), 'dune');
    store.put(row(stranger, { tmdbId: null, title: null, year: null, state: 'unrecognized' }));
    const gone = await put(join(library, 'Dune (2021).mkv'), 'dune');
    store.put(row(gone, {}));
    await rm(gone);
    const download = await put(join(inbox, 'Dune.2021.mkv'), 'dune');
    expect(await finder.verdict(arrival(download), 'films', 438631)).toBeNull();
  });

  it('reads the size from the disk when the snapshot has none (never probed)', async () => {
    const { store, finder, library, inbox } = await setup();
    const there = await put(join(library, 'Dune (2021).mkv'), 'dune!');
    store.put(row(there, {}));
    expect(store.probeOf('films', there)).toMatchObject({ size: 0, probedAt: null });
    const copy = await put(join(inbox, 'Dune.mkv'), 'dune!');
    expect(await finder.verdict(arrival(copy), 'films', 438631)).toMatchObject({
      kind: 'same-size',
    });
  });

  it('says nothing when the arrival itself is gone', async () => {
    const { store, finder, library, inbox } = await setup();
    store.put(row(await put(join(library, 'Dune (2021).mkv'), 'dune'), {}));
    expect(await finder.verdict(arrival(join(inbox, 'missing.mkv')), 'films', 438631)).toBeNull();
  });
});

describe('DuplicateFinder, for an episode', () => {
  const episode = (path: string, extra: Partial<LibraryItem>): LibraryItem =>
    row(path, { kind: 'series', tmdbId: 1, title: 'Show', season: 1, episode: 1, ...extra });

  it('compares the same season and episode, and a double episode covers both', async () => {
    const { store, finder, library, inbox } = await setup();
    const one = await put(join(library, 'Show - s01e01.mkv'), 'first');
    const double = await put(join(library, 'Show - s01e02-e03.mkv'), 'second and third');
    store.put(episode(one, {}));
    store.put(episode(double, { episode: 2, episodeEnd: 3 }));

    const copy = await put(join(inbox, 'Show.S01E01.mkv'), 'first');
    expect(
      await finder.verdict(
        arrival(copy, { kind: 'episode', season: 1, episodes: [1] }),
        'films',
        1,
      ),
    ).toMatchObject({ kind: 'same-size', path: one });

    // The third episode of the double file is held by it.
    const three = await put(join(inbox, 'Show.S01E03.mkv'), 'second and third');
    expect(
      await finder.verdict(
        arrival(three, { kind: 'episode', season: 1, episodes: [3] }),
        'films',
        1,
      ),
    ).toMatchObject({ kind: 'same-size', path: double });

    // A double episode arriving overlaps the double file by one episode.
    const overlap = await put(join(inbox, 'Show.S01E03E04.mkv'), 'different');
    expect(
      await finder.verdict(
        arrival(overlap, { kind: 'episode', season: 1, episodes: [3, 4] }),
        'films',
        1,
      ),
    ).toMatchObject({ kind: 'other-version', path: double });
  });

  it('says nothing for another season or an episode the library lacks', async () => {
    const { store, finder, library, inbox } = await setup();
    store.put(episode(await put(join(library, 'Show - s01e01.mkv'), 'first'), {}));
    const later = await put(join(inbox, 'Show.S02E01.mkv'), 'first');
    expect(
      await finder.verdict(
        arrival(later, { kind: 'episode', season: 2, episodes: [1] }),
        'films',
        1,
      ),
    ).toBeNull();
    const next = await put(join(inbox, 'Show.S01E02.mkv'), 'first');
    expect(
      await finder.verdict(
        arrival(next, { kind: 'episode', season: 1, episodes: [2] }),
        'films',
        1,
      ),
    ).toBeNull();
  });
});
