import { lstat, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPlan,
  executePlan,
  loadBundledProfile,
  MemoryJournal,
  type Plan,
} from '../src/index.js';
import { movie } from './fake-provider.js';
import { cleanup, counter, makeDir, parsedMovie, put } from './workspace.js';

const plex = await loadBundledProfile('plex');
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
