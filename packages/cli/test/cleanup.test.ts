import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, harness, makeDir, put } from './helpers.js';

afterEach(cleanup);

const DAY_MS = 24 * 3_600_000;
const inDays = (days: number) => () => Date.now() + days * DAY_MS;
const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

/** What an interrupted copy of `Dune (2021).mkv` leaves behind. */
const TEMP = '.Dune (2021).mkv.0a1b2c3d.kinoshelf-tmp';

describe('cleanup', () => {
  it('lists the stale temporary files and removes nothing without --apply', async () => {
    const lib = await makeDir();
    const path = await put(join(lib, 'Dune (2021)', TEMP), 'partial');
    const h = await harness({}, { now: inDays(3) });

    expect(await h.cli('cleanup', lib)).toBe(0);

    const text = h.out.join('\n');
    expect(text).toContain(path);
    expect(text).toContain('7 B · untouched for 72 h');
    expect(text).toContain('1 found, 0 removed, 0 failed.');
    expect(text).toContain('Dry run: nothing was removed.');
    expect(await exists(path)).toBe(true);
  });

  it('removes them with --apply', async () => {
    const lib = await makeDir();
    const path = await put(join(lib, TEMP));
    const h = await harness({}, { now: inDays(3) });

    expect(await h.cli('cleanup', lib, '--apply')).toBe(0);

    expect(h.out.join('\n')).toContain('1 found, 1 removed, 0 failed.');
    expect(await exists(path)).toBe(false);
  });

  it('leaves a recent file alone, even with --apply', async () => {
    const lib = await makeDir();
    const path = await put(join(lib, TEMP));
    const h = await harness();

    expect(await h.cli('cleanup', lib, '--apply')).toBe(0);

    expect(h.out.join('\n')).toContain('No stale temporary file found.');
    expect(await exists(path)).toBe(true);
  });

  it('honors --older-than', async () => {
    const lib = await makeDir();
    const path = await put(join(lib, TEMP));
    const young = await harness({}, { now: inDays(2) });
    await young.cli('cleanup', lib, '--older-than', '72', '--apply');
    expect(await exists(path)).toBe(true);

    const old = await harness({}, { now: inDays(4) });
    await old.cli('cleanup', lib, '--older-than', '72', '--apply');
    expect(await exists(path)).toBe(false);
  });

  it('scans the configured destinations by default, never the sources', async () => {
    const movies = await makeDir();
    const series = await makeDir();
    const source = await makeDir();
    const h = await harness({}, { now: inDays(3) });
    await put(
      join(h.configDir, 'config.yaml'),
      `destination:\n  movies: ${movies}\n  series: ${series}\n`,
    );
    const inMovies = await put(join(movies, TEMP));
    const inSeries = await put(join(series, 'Show', TEMP));
    const inSource = await put(join(source, TEMP));

    expect(await h.cli('cleanup', '--apply')).toBe(0);

    expect(await exists(inMovies)).toBe(false);
    expect(await exists(inSeries)).toBe(false);
    expect(await exists(inSource)).toBe(true);
  });

  it('never removes a file that is not one of ours', async () => {
    const lib = await makeDir();
    const others = await Promise.all(
      ['Dune.mkv', '.Dune.mkv.part', 'movie.tmp', '.Dune.mkv.0a1b2c3d.kinoshelf-tmp.bak'].map(
        (name) => put(join(lib, name)),
      ),
    );
    const h = await harness({}, { now: inDays(365) });

    expect(await h.cli('cleanup', lib, '--apply')).toBe(0);

    expect(await Promise.all(others.map(exists))).toEqual([true, true, true, true]);
  });

  it('needs a folder when the config has no destination', async () => {
    const h = await harness();
    expect(await h.cli('cleanup')).toBe(2);
    expect(h.err[0]).toMatch(
      /^Give at least one folder to scan, or set "destination" in .*config\.yaml\.$/,
    );
  });

  it.each([['0.5'], ['0'], ['-2']])('refuses --older-than %s as bad usage', async (hours) => {
    const lib = await makeDir();
    const h = await harness();
    expect(await h.cli('cleanup', lib, '--older-than', hours)).toBe(2);
    expect(h.err).toEqual(['The minimum age is 1 hour: a younger file may still be being copied.']);
  });

  it('refuses an --older-than that is not a number', async () => {
    const lib = await makeDir();
    const h = await harness();
    expect(await h.cli('cleanup', lib, '--older-than', 'soon')).toBe(2);
    expect(h.err).toEqual(['Invalid value "soon" for --older-than.']);
  });

  it('fails clearly on a folder that does not exist', async () => {
    const h = await harness();
    expect(await h.cli('cleanup', '/no/such/folder')).toBe(1);
    expect(h.err).toEqual(['Path not found: /no/such/folder']);
  });

  it('prints codes and parameters with --json', async () => {
    const lib = await makeDir();
    const path = await put(join(lib, TEMP), 'abc');
    const h = await harness({}, { now: inDays(3) });

    expect(await h.cli('--lang', 'fr', 'cleanup', lib, '--json')).toBe(0);

    const report = JSON.parse(h.out.join('\n')) as {
      dryRun: boolean;
      files: { path: string; status: string; sizeBytes: number }[];
    };
    expect(report.dryRun).toBe(true);
    expect(report.files).toMatchObject([{ path, status: 'stale', sizeBytes: 3 }]);
  });

  it('speaks French', async () => {
    const lib = await makeDir();
    await put(join(lib, TEMP));
    const h = await harness({}, { now: inDays(3) });
    await h.cli('--lang', 'fr', 'cleanup', lib);
    expect(h.out.join('\n')).toContain('1 trouvé, 0 supprimé, 0 en échec.');
    expect(h.out.join('\n')).toContain('Simulation : rien n’a été supprimé.');
  });
});
