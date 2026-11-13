import { lstat, readFile, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPlan,
  executePlan,
  buildProfile,
  madeByUs,
  MemoryJournal,
  type Plan,
  type SeriesDetails,
} from '../src/index.js';
import { movie, series } from './fake-provider.js';
import { cleanup, counter, makeDir, parsedEpisode, parsedMovie, put } from './workspace.js';

const plex = buildProfile({ naming: 'with-id', metadata: 'none' });
const dune = movie(438631, 'Dune', 2021);

afterEach(cleanup);

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

/** A library where Dune sits in an old layout, with a poster Kinoshelf wrote there before. */
async function setup() {
  const root = await makeDir();
  const old = join(root, 'Dune (2021) [tmdbid-438631]');
  const source = await put(join(old, 'Dune (2021) [tmdbid-438631].mkv'), 'video');
  const poster = await put(join(old, 'poster.jpg'), 'image');
  const journal = new MemoryJournal();
  const written = await stat(poster);
  journal.record({
    kind: 'downloaded',
    id: 'old-1',
    batchId: 'old',
    source: 'https://example.test/poster.jpg',
    destination: poster,
    createdDirectories: [],
    at: '2026-01-01T00:00:00Z',
    identity: { size: written.size, mtimeMs: written.mtimeMs },
  });
  const plan: Plan = await createPlan([{ parsed: parsedMovie(source), candidate: dune }], {
    profile: plex,
    destinationRoot: root,
    mode: 'move',
    newId: counter('p'),
  });
  return { root, old, poster, journal, plan };
}

const run = (plan: Plan, journal: MemoryJournal, dryRun = false) =>
  executePlan(plan, { journal, dryRun, newId: counter('x') });

describe('cleaning the folder a move left behind', () => {
  it('removes it with the artwork Kinoshelf wrote there, never the library root', async () => {
    const { root, old, poster, journal, plan } = await setup();
    await run(plan, journal);
    expect(await exists(poster)).toBe(false);
    expect(await exists(old)).toBe(false);
    expect(await exists(root)).toBe(true);
  });

  it('keeps the folder in a dry run', async () => {
    const { old, poster, journal, plan } = await setup();
    await run(plan, journal, true);
    expect(await exists(old)).toBe(true);
    expect(await exists(poster)).toBe(true);
  });

  it('keeps a poster the user replaced since', async () => {
    const { old, poster, journal, plan } = await setup();
    await utimes(poster, new Date('2001-01-01'), new Date('2001-01-01'));
    await run(plan, journal);
    expect(await exists(poster)).toBe(true);
    expect(await exists(old)).toBe(true);
  });

  it('keeps a folder holding a file Kinoshelf did not make', async () => {
    const { old, poster, journal, plan } = await setup();
    const other = await put(join(old, 'notes.txt'), 'mine');
    await run(plan, journal);
    expect(await exists(other)).toBe(true);
    expect(await exists(poster)).toBe(true);
  });

  it('keeps a file Kinoshelf has no record of making', async () => {
    const { old, poster, plan } = await setup();
    await run(plan, new MemoryJournal());
    expect(await exists(poster)).toBe(true);
    expect(await exists(old)).toBe(true);
  });

  it('does not remove a folder outside the destination root', async () => {
    const { root, journal } = await setup();
    const arrivals = await makeDir();
    const release = join(arrivals, 'Dune.2021');
    const source = await put(join(release, 'dune.mkv'), 'video');
    const plan = await createPlan([{ parsed: parsedMovie(source), candidate: dune }], {
      profile: plex,
      destinationRoot: root,
      mode: 'move',
      newId: counter('q'),
    });
    await run(plan, journal);
    expect(await exists(release)).toBe(true);
  });
});

describe('madeByUs', () => {
  const record = async (journal: MemoryJournal, path: string) => {
    const written = await stat(path);
    journal.record({
      kind: 'generated',
      id: `made-${path}`,
      batchId: 'old',
      source: '',
      destination: path,
      createdDirectories: [],
      at: '2026-01-01T00:00:00Z',
      identity: { size: written.size, mtimeMs: written.mtimeMs },
    });
  };

  it('is true for a file Kinoshelf wrote and nobody touched', async () => {
    const file = await put(join(await makeDir(), 'a.nfo'), '<movie/>');
    const journal = new MemoryJournal();
    await record(journal, file);
    expect(await madeByUs(journal, file)).toBe(true);
  });

  it('is false once the file changed, for one the journal does not know, and for a missing one', async () => {
    const dir = await makeDir();
    const edited = await put(join(dir, 'edited.nfo'), '<movie/>');
    const unknown = await put(join(dir, 'unknown.nfo'), '<movie/>');
    const journal = new MemoryJournal();
    await record(journal, edited);
    await utimes(edited, new Date('2001-01-01'), new Date('2001-01-01'));
    expect(await madeByUs(journal, edited)).toBe(false);
    expect(await madeByUs(journal, unknown)).toBe(false);
    expect(await madeByUs(journal, join(dir, 'gone.nfo'))).toBe(false);
  });
});

describe('an episode matched again to another show', () => {
  const nfo = buildProfile({ naming: 'no-id', metadata: 'nfo' });
  const foundation = series(93740, 'Foundation', 2021);
  const details: SeriesDetails = {
    kind: 'series',
    id: { provider: 'tmdb', id: 93740 },
    title: 'Foundation',
    originalTitle: 'Foundation',
    genres: [],
    tags: [],
    studios: [],
    countries: [],
    cast: [],
    seasons: [{ season: 1 }],
  };

  async function matchedAgain(editedSince: boolean) {
    const root = await makeDir();
    const old = join(root, 'The Bear (2022)', 'Season 01');
    const video = await put(join(old, 'The Bear (2022) - s01e01.mkv'), 'video');
    const stale = await put(
      join(old, 'The Bear (2022) - s01e01.nfo'),
      '<episodedetails><title>The Bear</title></episodedetails>',
    );
    const journal = new MemoryJournal();
    const written = await stat(stale);
    journal.record({
      kind: 'generated',
      id: 'old-nfo',
      batchId: 'old',
      source: '',
      destination: stale,
      createdDirectories: [],
      at: '2026-01-01T00:00:00Z',
      identity: { size: written.size, mtimeMs: written.mtimeMs },
    });
    if (editedSince) {
      await utimes(stale, new Date('2001-01-01'), new Date('2001-01-01'));
    }
    const plan = await createPlan(
      [{ parsed: parsedEpisode(video, 1, [1]), candidate: foundation, details }],
      {
        profile: nfo,
        destinationRoot: root,
        mode: 'move',
        newId: counter('p'),
        madeByUs: (path) => madeByUs(journal, path),
      },
    );
    await executePlan(plan, { journal, newId: counter('x') });
    const moved = join(root, 'Foundation (2021)', 'Season 01', 'Foundation (2021) - s01e01.nfo');
    return { root, old, stale, moved };
  }

  it('gets the NFO of its new show, and the old one goes with its folder', async () => {
    const { root, old, stale, moved } = await matchedAgain(false);
    const content = await readFile(moved, 'utf8');
    expect(content).toContain('Foundation');
    expect(content).not.toContain('The Bear');
    expect(await exists(stale)).toBe(false);
    expect(await exists(join(root, 'The Bear (2022)'))).toBe(false);
    expect(await exists(old)).toBe(false);
  });

  it('keeps the NFO of an owner who changed it since where it was, and writes the new one', async () => {
    const { root, stale, moved } = await matchedAgain(true);
    expect(await readFile(moved, 'utf8')).toContain('Foundation');
    // Not deleted and not carried along: it is the owner's, and so is the folder that holds it.
    expect(await readFile(stale, 'utf8')).toContain('The Bear');
    expect(await exists(join(root, 'The Bear (2022)'))).toBe(true);
  });
});
