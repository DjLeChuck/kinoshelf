import { existsSync } from 'node:fs';
import { lstat, readdir, readFile, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPlan,
  KinoshelfError,
  executePlan,
  loadBundledProfile,
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

const plex = await loadBundledProfile('plex');
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
        kind: 'transfer',
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

describe('executePlan: batchId', () => {
  it('uses the batch id the caller chose, in the result and in the journal', async () => {
    const { plan, journal } = await setup();
    const batch = await executePlan(plan, {
      journal,
      batchId: 'chosen-batch',
      newId: counter('x'),
    });
    expect(batch.batchId).toBe('chosen-batch');
    expect(journal.lastBatchId()).toBe('chosen-batch');
  });
});

describe('executePlan: onItem', () => {
  it('reports each item once it is done and journaled, before the next one starts', async () => {
    const { plan, journal, root } = await setup();
    const seen: { itemId: string; journaled: number; onDisk: boolean }[] = [];

    await executePlan(plan, {
      journal,
      newId: counter('x'),
      onItem: (result) =>
        seen.push({
          itemId: result.itemId,
          journaled: journal.entriesOf(journal.lastBatchId() ?? '').length,
          onDisk: existsSync(join(root, FOLDER, `${STEM}.mkv`)),
        }),
    });

    expect(seen).toEqual([{ itemId: plan.items[0]?.id, journaled: 1, onDisk: true }]);
  });

  it('also reports the items it did not run, with no result', async () => {
    const { plan, journal } = await setup();
    const held = {
      ...plan,
      items: plan.items.map((item) => ({ ...item, status: 'in-place' as const })),
    };
    const seen: number[] = [];
    await executePlan(held, { journal, onItem: (result) => seen.push(result.results.length) });
    expect(seen).toEqual([0]);
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

describe('executePlan: generated and downloaded files', () => {
  const POSTER = 'poster.jpg';

  /** The plan of `setup` with companion operations added after its video transfer. */
  async function withCompanions(
    mode: TransferMode,
    extra: (root: string) => Plan['items'][number]['operations'],
    lib?: string,
  ) {
    const base = await setup(mode, lib);
    const item = base.plan.items[0];
    if (!item) {
      throw new Error('no item');
    }
    const plan: Plan = {
      ...base.plan,
      items: [{ ...item, operations: [...item.operations, ...extra(base.root)] }],
    };
    return { ...base, plan };
  }
  const nfo = (root: string, content = '<movie/>') => ({
    type: 'write-file' as const,
    destination: join(root, FOLDER, 'movie.nfo'),
    content,
  });
  const poster = (root: string, url = 'https://img.example/p.jpg') => ({
    type: 'download' as const,
    url,
    destination: join(root, FOLDER, POSTER),
  });
  const bytes = new Uint8Array([1, 2, 3]);
  const okFetch = (url: string): Promise<Uint8Array> => {
    expect(url).toBeTypeOf('string');
    return Promise.resolve(bytes);
  };

  it('writes the content atomically, journals it as generated and leaves no temporary file', async () => {
    const { root, plan, journal } = await withCompanions('copy', (r) => [nfo(r)]);
    const batch = await run(plan, journal);

    expect(statuses(batch)).toEqual(['done', 'done']);
    expect(await readFile(join(root, FOLDER, 'movie.nfo'), 'utf8')).toBe('<movie/>');
    expect((await readdir(join(root, FOLDER))).sort()).toEqual([`${STEM}.mkv`, 'movie.nfo']);
    expect(journal.entriesOf(batch.batchId)[1]).toMatchObject({
      kind: 'generated',
      source: '',
      destination: join(root, FOLDER, 'movie.nfo'),
      createdDirectories: [],
    });
  });

  it('never overwrites a file already there, the video still arrives', async () => {
    const lib = await makeDir();
    await put(join(lib, FOLDER, 'movie.nfo'), 'mine');
    const { root, plan, journal } = await withCompanions('copy', (r) => [nfo(r)], lib);
    const batch = await run(plan, journal);

    expect(statuses(batch)).toEqual(['done', 'skipped']);
    expect(batch.items[0]?.results[1]?.error).toEqual({
      code: 'destination.exists',
      params: { path: join(root, FOLDER, 'movie.nfo') },
    });
    expect(await readFile(join(root, FOLDER, 'movie.nfo'), 'utf8')).toBe('mine');
    expect(journal.entriesOf(batch.batchId)).toHaveLength(1);
  });

  it('does not even fetch an image whose destination already exists', async () => {
    const lib = await makeDir();
    await put(join(lib, FOLDER, POSTER), 'mine');
    const { root, plan, journal } = await withCompanions('copy', (r) => [poster(r)], lib);
    let fetched = false;
    const batch = await executePlan(plan, {
      journal,
      fetchImage: () => {
        fetched = true;
        return okFetch('');
      },
    });
    expect(statuses(batch)).toEqual(['done', 'skipped']);
    expect(fetched).toBe(false);
    expect(await readFile(join(root, FOLDER, POSTER), 'utf8')).toBe('mine');
  });

  it('never overwrites a file that appears while the image is being fetched', async () => {
    const { root, plan, journal } = await withCompanions('copy', (r) => [poster(r)]);
    const batch = await executePlan(plan, {
      journal,
      newId: counter('x'),
      fetchImage: async () => {
        await put(join(root, FOLDER, POSTER), 'mine');
        return bytes;
      },
    });

    expect(statuses(batch)).toEqual(['done', 'skipped']);
    expect(await readFile(join(root, FOLDER, POSTER), 'utf8')).toBe('mine');
    expect((await readdir(join(root, FOLDER))).sort()).toEqual([`${STEM}.mkv`, POSTER]);
  });

  it('downloads through the injected fetcher and journals the url as the source', async () => {
    const urls: string[] = [];
    const { root, plan, journal } = await withCompanions('copy', (r) => [poster(r)]);
    const batch = await executePlan(plan, {
      journal,
      newId: counter('x'),
      fetchImage: (url) => {
        urls.push(url);
        return okFetch(url);
      },
    });

    expect(statuses(batch)).toEqual(['done', 'done']);
    expect(urls).toEqual(['https://img.example/p.jpg']);
    expect([...(await readFile(join(root, FOLDER, POSTER)))]).toEqual([1, 2, 3]);
    expect(journal.entriesOf(batch.batchId)[1]).toMatchObject({
      kind: 'downloaded',
      source: 'https://img.example/p.jpg',
    });
  });

  it('keeps the video and the item when a download fails, reporting the cause', async () => {
    const { root, plan, journal } = await withCompanions('move', (r) => [poster(r), nfo(r)]);
    const batch = await executePlan(plan, {
      journal,
      newId: counter('x'),
      fetchImage: () =>
        Promise.reject(new KinoshelfError('execute.download-failed', { url: 'u', status: 404 })),
    });

    expect(statuses(batch)).toEqual(['done', 'failed', 'done']);
    expect(batch.items[0]?.results[1]?.error).toEqual({
      code: 'execute.download-failed',
      params: { url: 'u', status: 404 },
    });
    expect(await exists(join(root, FOLDER, `${STEM}.mkv`))).toBe(true);
    expect(await exists(join(root, FOLDER, POSTER))).toBe(false);
    expect(journal.entriesOf(batch.batchId).map((e) => e.kind)).toEqual(['transfer', 'generated']);
  });

  it('reports an unexpected fetch error as a failed download', async () => {
    const { root, plan, journal } = await withCompanions('copy', (r) => [poster(r)]);
    const batch = await executePlan(plan, {
      journal,
      fetchImage: () => Promise.reject(new Error('boom')),
    });
    expect(batch.items[0]?.results[1]).toMatchObject({
      status: 'failed',
      error: { code: 'execute.download-failed', params: { status: 'network' } },
    });
    expect(await exists(join(root, FOLDER, POSTER))).toBe(false);
  });

  it('refuses an image over 20 MB', async () => {
    const { root, plan, journal } = await withCompanions('copy', (r) => [poster(r)]);
    const batch = await executePlan(plan, {
      journal,
      fetchImage: () => Promise.resolve(new Uint8Array(20 * 1024 * 1024 + 1)),
    });
    expect(batch.items[0]?.results[1]?.error?.code).toBe('execute.download-too-large');
    expect(await exists(join(root, FOLDER, POSTER))).toBe(false);
  });

  it('writes nothing next to a video that did not arrive', async () => {
    const { root, plan, journal } = await withCompanions('copy', (r) => [nfo(r), poster(r)]);
    // Appears after planning, so only the executor's own re-check can see it.
    await put(join(root, FOLDER, `${STEM}.mkv`), 'mine');
    let fetched = false;
    const batch = await executePlan(plan, {
      journal,
      fetchImage: () => {
        fetched = true;
        return okFetch('');
      },
    });

    expect(statuses(batch)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(batch.items[0]?.results[1]?.error?.code).toBe('main-not-done');
    expect(fetched).toBe(false);
    expect(await readdir(join(root, FOLDER))).toEqual([`${STEM}.mkv`]);
  });

  it('touches nothing and fetches nothing in a dry run', async () => {
    const { root, plan, journal } = await withCompanions('copy', (r) => [nfo(r), poster(r)]);
    let fetched = false;
    const batch = await executePlan(plan, {
      journal,
      dryRun: true,
      fetchImage: () => {
        fetched = true;
        return okFetch('');
      },
    });

    expect(statuses(batch)).toEqual(['done', 'done', 'done']);
    expect(fetched).toBe(false);
    expect(await exists(join(root, FOLDER))).toBe(false);
    expect(journal.lastBatchId()).toBeNull();
  });

  it('creates the missing directories and journals them for undo', async () => {
    const { root, plan, journal } = await withCompanions('copy', (r) => [
      { ...nfo(r), destination: join(r, FOLDER, 'extras', 'a.nfo') },
    ]);
    const batch = await run(plan, journal);
    const entries = journal.entriesOf(batch.batchId);
    expect(entries[1]?.createdDirectories).toEqual([join(root, FOLDER, 'extras')]);
  });
});
