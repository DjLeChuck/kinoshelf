import { basename } from 'node:path';
import { chmod, lstat, symlink, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupStaleTemporaryFiles } from '../src/index.js';
import { copyAtomic, isTemporaryName, temporaryPathFor } from '../src/execution/fs-ops.js';
import { cleanup, makeDir, put } from './workspace.js';

afterEach(cleanup);

const DAY_MS = 24 * 3_600_000;
const later = (days: number) => () => Date.now() + days * DAY_MS;
const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

/** What an interrupted copy of `Dune (2021).mkv` leaves behind. */
const TEMP = '.Dune (2021).mkv.0a1b2c3d.kinoshelf-tmp';

describe('temporary file names', () => {
  it('are recognized by the cleanup, whatever the destination', () => {
    for (const destination of [
      '/lib/Dune (2021).mkv',
      '/lib/a b/The.Bear.S03E04.mkv',
      '/x/é.mkv',
    ]) {
      expect(isTemporaryName(basename(temporaryPathFor(destination)))).toBe(true);
    }
  });

  it.each([
    ['a plain video', 'Dune (2021).mkv'],
    ['another tool’s temp file', '.Dune.mkv.part'],
    ['a hidden file', '.DS_Store'],
    ['our suffix without the leading dot', 'Dune.mkv.0a1b2c3d.kinoshelf-tmp'],
    ['a suffix with non-hex digits', '.Dune.mkv.0a1b2c3z.kinoshelf-tmp'],
    ['a suffix of the wrong length', '.Dune.mkv.0a1b2c3.kinoshelf-tmp'],
    ['something after the suffix', '.Dune.mkv.0a1b2c3d.kinoshelf-tmp.bak'],
    ['an upper-case id', '.Dune.mkv.0A1B2C3D.kinoshelf-tmp'],
  ])('do not match %s', (_name, name) => {
    expect(isTemporaryName(name)).toBe(false);
  });

  it('is exactly what an interrupted copy leaves', async () => {
    const lib = await makeDir();
    const source = await put(join(lib, 'src.mkv'), 'x');
    // Force a failure after the temporary file exists: the destination is a directory.
    const destination = join(lib, 'out.mkv');
    await put(join(destination, 'inside'));
    await expect(copyAtomic(source, destination)).rejects.toThrow();
    // The copy cleans up after itself on failure: nothing is left to find.
    const found = await cleanupStaleTemporaryFiles([lib], {
      olderThanHours: 1,
      dryRun: true,
      now: later(30),
    });
    expect(found).toEqual([]);
  });
});

describe('cleanupStaleTemporaryFiles', () => {
  it('reports an old temporary file in a dry run and keeps it', async () => {
    const lib = await makeDir();
    const path = await put(join(lib, 'Dune (2021)', TEMP), 'partial');

    const found = await cleanupStaleTemporaryFiles([lib], {
      olderThanHours: 24,
      dryRun: true,
      now: later(3),
    });

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ path, sizeBytes: 7, status: 'stale' });
    expect(found[0]?.ageHours).toBeGreaterThan(71);
    expect(await exists(path)).toBe(true);
  });

  it('removes it with dryRun off', async () => {
    const lib = await makeDir();
    const path = await put(join(lib, TEMP));
    const found = await cleanupStaleTemporaryFiles([lib], {
      olderThanHours: 24,
      dryRun: false,
      now: later(2),
    });
    expect(found.map((f) => f.status)).toEqual(['removed']);
    expect(await exists(path)).toBe(false);
  });

  it('keeps a young file, however old its modification date says it is', async () => {
    const lib = await makeDir();
    const path = await put(join(lib, TEMP), 'being written');
    // A finished copy gets its source's mtime (here 1970) right before it is published.
    await utimes(path, new Date(0), new Date(0));

    const found = await cleanupStaleTemporaryFiles([lib], { olderThanHours: 1, dryRun: false });

    expect(found).toEqual([]);
    expect(await exists(path)).toBe(true);
  });

  it('never touches what is not one of ours, even when old', async () => {
    const lib = await makeDir();
    const innocents = await Promise.all(
      [
        'Dune (2021).mkv',
        '.Dune.mkv.part',
        '.DS_Store',
        'Dune.mkv.0a1b2c3d.kinoshelf-tmp',
        '.Dune.mkv.0a1b2c3d.kinoshelf-tmp.bak',
        'notes.tmp',
      ].map((name) => put(join(lib, name))),
    );

    const found = await cleanupStaleTemporaryFiles([lib], {
      olderThanHours: 1,
      dryRun: false,
      now: later(365),
    });

    expect(found).toEqual([]);
    expect(await Promise.all(innocents.map(exists))).toEqual(innocents.map(() => true));
  });

  it('does not follow or remove symbolic links', async () => {
    const lib = await makeDir();
    const outside = await makeDir();
    const target = await put(join(outside, 'precious.mkv'), 'keep');
    await symlink(target, join(lib, TEMP));
    await put(join(outside, TEMP), 'not under the scanned folder');
    await symlink(outside, join(lib, 'linked-folder'));

    const found = await cleanupStaleTemporaryFiles([lib], {
      olderThanHours: 1,
      dryRun: false,
      now: later(30),
    });

    expect(found).toEqual([]);
    expect(await exists(target)).toBe(true);
    expect(await exists(join(outside, TEMP))).toBe(true);
  });

  it('descends into folders and handles several roots', async () => {
    const [one, two] = [await makeDir(), await makeDir()];
    const deep = await put(join(one, 'a', 'b', TEMP));
    const other = await put(join(two, TEMP));
    const found = await cleanupStaleTemporaryFiles([one, two], {
      olderThanHours: 1,
      dryRun: true,
      now: later(2),
    });
    expect(found.map((f) => f.path).sort()).toEqual([deep, other].sort());
  });

  it('reports a file it cannot remove and goes on', async () => {
    const lib = await makeDir();
    const locked = join(lib, 'locked');
    await put(join(locked, TEMP));
    const free = await put(join(lib, TEMP));
    await chmod(locked, 0o500); // read-only folder: the file cannot be unlinked

    const found = await cleanupStaleTemporaryFiles([lib], {
      olderThanHours: 1,
      dryRun: false,
      now: later(2),
    });
    await chmod(locked, 0o700);

    expect(found.map((f) => f.status).sort()).toEqual(['failed', 'removed']);
    expect(found.find((f) => f.status === 'failed')?.error?.code).toBe('fs.permission-denied');
    expect(await exists(free)).toBe(false);
  });

  it.each([[0.5], [0], [-3], [Number.NaN]])('refuses an age of %s hour(s)', async (hours) => {
    const lib = await makeDir();
    await expect(
      cleanupStaleTemporaryFiles([lib], { olderThanHours: hours, dryRun: false }),
    ).rejects.toMatchObject({
      info: { code: 'cleanup.age-too-short', params: { min: 1 } },
    });
  });

  it('fails clearly on a folder that does not exist', async () => {
    await expect(
      cleanupStaleTemporaryFiles(['/no/such/folder'], { olderThanHours: 1, dryRun: true }),
    ).rejects.toMatchObject({
      info: { code: 'discover.not-found', params: { path: '/no/such/folder' } },
    });
  });
});
