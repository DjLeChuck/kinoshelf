import { lstat, readdir, readFile, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPlan,
  executePlan,
  loadProfileFile,
  MemoryJournal,
  type BatchResult,
  type Plan,
  type TransferMode,
} from '../src/index.js';
import { movie } from './fake-provider.js';
import {
  cleanup,
  counter,
  crossDeviceAvailable,
  makeDir,
  parsedMovie,
  put,
  SHM,
} from './workspace.js';

const plex = await loadProfileFile(new URL('../../../profiles/plex.yaml', import.meta.url));
const dune = movie(438631, 'Dune', 2021);
const FOLDER = 'Dune (2021) {tmdb-438631}';
const STEM = 'Dune (2021) {tmdb-438631}';

afterEach(cleanup);

async function setup(mode: TransferMode = 'copy', lib?: string) {
  const src = await makeDir();
  const root = lib ?? (await makeDir());
  const source = await put(join(src, 'Dune.2021.mkv'), 'video-bytes');
  const planned = await createPlan([{ parsed: parsedMovie(source), candidate: dune }], {
    profile: plex,
    destinationRoot: root,
    mode,
    newId: counter('p'),
  });
  return { src, root, source, plan: planned, journal: new MemoryJournal() };
}

const run = (plan: Plan, journal: MemoryJournal, dryRun = false): Promise<BatchResult> =>
  executePlan(plan, { journal, dryRun, newId: counter('x') });

const statuses = (batch: BatchResult) => batch.items.flatMap((i) => i.results.map((r) => r.status));

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

describe('executePlan: copy', () => {
  it('copies atomically, keeps the source and leaves no temporary file', async () => {
    const { root, source, plan, journal } = await setup('copy');
    await utimes(source, new Date('2020-01-02T03:04:05Z'), new Date('2020-01-02T03:04:05Z'));

    const batch = await run(plan, journal);
    const destination = join(root, FOLDER, `${STEM}.mkv`);

    expect(statuses(batch)).toEqual(['done']);
    expect(await readFile(destination, 'utf8')).toBe('video-bytes');
    expect(await readFile(source, 'utf8')).toBe('video-bytes');
    expect(await readdir(join(root, FOLDER))).toEqual([`${STEM}.mkv`]);
    expect(Math.floor((await stat(destination)).mtimeMs)).toBe(
      Math.floor(new Date('2020-01-02T03:04:05Z').getTime()),
    );
  });

  it('journals the transfer with the directories it created', async () => {
    const { root, source, plan, journal } = await setup('copy');
    const batch = await run(plan, journal);

    expect(journal.lastBatchId()).toBe(batch.batchId);
    expect(journal.entriesOf(batch.batchId)).toEqual([
      {
        id: 'x-2',
        batchId: 'x-1',
        source,
        destination: join(root, FOLDER, `${STEM}.mkv`),
        mode: 'copy',
        at: expect.any(String) as string,
        createdDirectories: [join(root, FOLDER)],
      },
    ]);
  });

  it('does not list a directory that already existed as created', async () => {
    const lib = await makeDir();
    await put(join(lib, FOLDER, 'keep.txt'));
    const { plan, journal } = await setup('copy', lib);
    const batch = await run(plan, journal);
    expect(journal.entriesOf(batch.batchId)[0]?.createdDirectories).toEqual([]);
  });
});

describe('executePlan: hardlink and move', () => {
  it('hardlinks to the same inode', async () => {
    const { root, source, plan, journal } = await setup('hardlink');
    await run(plan, journal);
    const [a, b] = await Promise.all([stat(source), stat(join(root, FOLDER, `${STEM}.mkv`))]);
    expect(a.ino).toBe(b.ino);
    expect(a.nlink).toBe(2);
  });

  it('moves, removing the source', async () => {
    const { root, source, plan, journal } = await setup('move');
    await run(plan, journal);
    expect(await exists(source)).toBe(false);
    expect(await readFile(join(root, FOLDER, `${STEM}.mkv`), 'utf8')).toBe('video-bytes');
  });

  it.skipIf(!crossDeviceAvailable)('moves across filesystems by a verified copy', async () => {
    const { root, source, plan, journal } = await setup('move', await makeDir(SHM));
    const batch = await run(plan, journal);
    expect(statuses(batch)).toEqual(['done']);
    expect(await exists(source)).toBe(false);
    expect(await readFile(join(root, FOLDER, `${STEM}.mkv`), 'utf8')).toBe('video-bytes');
  });

  it.skipIf(!crossDeviceAvailable)(
    'fails a cross-device hardlink explicitly and creates nothing',
    async () => {
      const { src, root, source } = await setup('copy', await makeDir(SHM));
      // The planner would hold this back, so the plan is forged to prove the executor
      // refuses on its own, without falling back to a copy.
      const forged: Plan = {
        id: 'forged',
        createdAt: '2026-10-28T00:00:00.000Z',
        profileId: 'plex',
        destinationRoot: root,
        mode: 'hardlink',
        items: [
          {
            id: 'i',
            status: 'ready',
            parsed: parsedMovie(source),
            externalId: dune.id,
            conflicts: [],
            operations: [
              {
                type: 'transfer',
                mode: 'hardlink',
                role: 'main',
                source,
                destination: join(root, FOLDER, `${STEM}.mkv`),
              },
            ],
          },
        ],
      };
      const journal = new MemoryJournal();
      const batch = await run(forged, journal);

      expect(batch.items[0]?.results[0]).toMatchObject({
        status: 'failed',
        error: { code: 'hardlink.cross-device' },
      });
      expect(await readdir(root)).toEqual([]);
      expect(journal.lastBatchId()).toBeNull();
      expect(await readFile(join(src, 'Dune.2021.mkv'), 'utf8')).toBe('video-bytes');
    },
  );
});

describe('executePlan: never overwrites', () => {
  it('skips a destination that appeared after the plan was made', async () => {
    const { root, plan, journal } = await setup('copy');
    const destination = await put(join(root, FOLDER, `${STEM}.mkv`), 'someone-elses');

    const batch = await run(plan, journal);

    expect(batch.items[0]?.results[0]).toMatchObject({
      status: 'skipped',
      error: { code: 'destination.exists' },
    });
    expect(await readFile(destination, 'utf8')).toBe('someone-elses');
    expect(journal.lastBatchId()).toBeNull();
  });

  it.each(['copy', 'hardlink', 'move'] as const)(
    '%s keeps an existing file intact',
    async (mode) => {
      const { root, source, plan, journal } = await setup(mode);
      const destination = await put(join(root, FOLDER, `${STEM}.mkv`), 'precious');
      await run(plan, journal);
      expect(await readFile(destination, 'utf8')).toBe('precious');
      expect(await exists(source)).toBe(true);
    },
  );

  it('does not touch items that are in conflict or in place', async () => {
    const { root, source, journal } = await setup('copy');
    const existing = await put(join(root, FOLDER, `${STEM}.mkv`), 'old');
    const replanned = await createPlan([{ parsed: parsedMovie(source), candidate: dune }], {
      profile: plex,
      destinationRoot: root,
      mode: 'copy',
    });
    expect(replanned.items[0]?.status).toBe('conflict');

    const batch = await run(replanned, journal);
    expect(batch.items).toEqual([{ itemId: replanned.items[0]?.id, results: [] }]);
    expect(await readFile(existing, 'utf8')).toBe('old');
  });
});

describe('executePlan: sidecars', () => {
  it('moves subtitles and NFO along with the video', async () => {
    const src = await makeDir();
    const lib = await makeDir();
    const source = await put(join(src, 'Dune.2021.mkv'), 'v');
    await put(join(src, 'Dune.2021.en.srt'), 'en');
    await put(join(src, 'Dune.2021.nfo'), 'nfo');
    const plan = await createPlan([{ parsed: parsedMovie(source), candidate: dune }], {
      profile: plex,
      destinationRoot: lib,
      mode: 'copy',
    });
    const batch = await run(plan, new MemoryJournal());

    expect(statuses(batch)).toEqual(['done', 'done', 'done']);
    expect((await readdir(join(lib, FOLDER))).sort()).toEqual([
      `${STEM}.en.srt`,
      `${STEM}.mkv`,
      `${STEM}.nfo`,
    ]);
  });

  it('skips a conflicting sidecar without blocking the video', async () => {
    const src = await makeDir();
    const lib = await makeDir();
    const source = await put(join(src, 'Dune.2021.mkv'), 'v');
    await put(join(src, 'Dune.2021.srt'), 'new-subs');
    const plan = await createPlan([{ parsed: parsedMovie(source), candidate: dune }], {
      profile: plex,
      destinationRoot: lib,
      mode: 'copy',
    });
    const existing = await put(join(lib, FOLDER, `${STEM}.srt`), 'my-subs');

    const batch = await run(plan, new MemoryJournal());
    expect(statuses(batch)).toEqual(['done', 'skipped']);
    expect(await readFile(existing, 'utf8')).toBe('my-subs');
    expect(await exists(join(lib, FOLDER, `${STEM}.mkv`))).toBe(true);
  });

  it('skips the sidecars when the video itself could not be transferred', async () => {
    const src = await makeDir();
    const lib = await makeDir();
    const source = await put(join(src, 'Dune.2021.mkv'), 'v');
    await put(join(src, 'Dune.2021.srt'), 's');
    const plan = await createPlan([{ parsed: parsedMovie(source), candidate: dune }], {
      profile: plex,
      destinationRoot: lib,
      mode: 'copy',
    });
    await rm(source);

    const batch = await run(plan, new MemoryJournal());
    expect(batch.items[0]?.results.map((r) => [r.status, r.error?.code])).toEqual([
      ['failed', 'source.missing'],
      ['skipped', 'main-not-done'],
    ]);
    expect(await exists(join(lib, FOLDER, `${STEM}.srt`))).toBe(false);
  });
});

describe('executePlan: failures and dry run', () => {
  it('reports a missing source and carries on with the other items', async () => {
    const src = await makeDir();
    const lib = await makeDir();
    const a = await put(join(src, 'a.mkv'), 'a');
    const b = await put(join(src, 'b.mkv'), 'b');
    const plan = await createPlan(
      [
        { parsed: parsedMovie(a), candidate: movie(1, 'Alpha', 2020) },
        { parsed: parsedMovie(b), candidate: movie(2, 'Beta', 2021) },
      ],
      { profile: plex, destinationRoot: lib, mode: 'copy' },
    );
    await rm(a);

    const journal = new MemoryJournal();
    const batch = await run(plan, journal);
    expect(batch.items.map((i) => i.results[0]?.status)).toEqual(['failed', 'done']);
    expect(journal.entriesOf(batch.batchId)).toHaveLength(1);
  });

  it('reports operations other than transfers as unsupported, without running them', async () => {
    const { root, plan } = await setup('copy');
    const [item] = plan.items;
    const forged: Plan = {
      ...plan,
      items: item
        ? [
            {
              ...item,
              operations: [
                { type: 'write-file', destination: join(root, 'x.nfo'), content: '<movie/>' },
              ],
            },
          ]
        : [],
    };
    const batch = await run(forged, new MemoryJournal());
    expect(batch.items[0]?.results[0]).toMatchObject({
      status: 'failed',
      error: { code: 'operation.unsupported' },
    });
    expect(await exists(join(root, 'x.nfo'))).toBe(false);
  });

  it('writes nothing in a dry run, yet reports what would happen', async () => {
    const { root, source, plan, journal } = await setup('move');
    const batch = await run(plan, journal, true);

    expect(batch.dryRun).toBe(true);
    expect(statuses(batch)).toEqual(['done']);
    expect(await readdir(root)).toEqual([]);
    expect(await exists(source)).toBe(true);
    expect(journal.lastBatchId()).toBeNull();
  });

  it('a dry run flags a destination that now exists and a vanished source', async () => {
    const { root, source, plan, journal } = await setup('copy');
    await put(join(root, FOLDER, `${STEM}.mkv`), 'x');
    expect(statuses(await run(plan, journal, true))).toEqual(['skipped']);

    await rm(source);
    const missing = await run(plan, journal, true);
    expect(missing.items[0]?.results[0]).toMatchObject({
      status: 'failed',
      error: { code: 'source.missing' },
    });
  });

  it.skipIf(!crossDeviceAvailable)('a dry run reports a cross-device hardlink', async () => {
    const { source, root } = await setup('copy', await makeDir(SHM));
    const forged: Plan = {
      id: 'f',
      createdAt: '2026-10-28T00:00:00.000Z',
      profileId: 'plex',
      destinationRoot: root,
      mode: 'hardlink',
      items: [
        {
          id: 'i',
          status: 'ready',
          parsed: parsedMovie(source),
          externalId: dune.id,
          conflicts: [],
          operations: [
            {
              type: 'transfer',
              mode: 'hardlink',
              role: 'main',
              source,
              destination: join(root, 'x.mkv'),
            },
          ],
        },
      ],
    };
    const batch = await run(forged, new MemoryJournal(), true);
    expect(batch.items[0]?.results[0]?.error?.code).toBe('hardlink.cross-device');
    expect(await readdir(root)).toEqual([]);
  });
});
