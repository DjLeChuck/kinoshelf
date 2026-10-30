import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { cleanup, harness, makeDir, put } from './helpers.js';

afterEach(cleanup);

const DUNE_DIR = 'Dune (2021) {tmdb-438631}';
const exists = (path: string): Promise<boolean> =>
  readFile(path).then(
    () => true,
    () => false,
  );

async function library() {
  const src = await makeDir();
  const dest = await makeDir();
  await put(join(src, 'Dune.2021.2160p.mkv'), 'dune');
  await put(join(src, 'Dune.2021.2160p.en.srt'), 'subs');
  await put(join(src, 'The.Bear.S03E04.mkv'), 'bear');
  await put(join(src, 'Dune.mkv'), 'ambiguous');
  await put(join(src, 'zzqx.2020.mkv'), 'nothing');
  return { src, dest };
}

describe('scan', () => {
  it('classifies every file and writes nothing', async () => {
    const { src, dest } = await library();
    const h = await harness();

    expect(await h.cli('scan', src, '--dest', dest)).toBe(0);

    const text = h.out.join('\n');
    expect(text).toContain('Video files analyzed: 4 · profile plex · mode copy');
    expect(text).toContain(`Destination: ${dest}`);
    expect(text).toContain('To organize (2)');
    expect(text).toContain(`→ ${join(DUNE_DIR, `Dune (2021) {tmdb-438631}.mkv`)}`);
    expect(text).toContain('+ 1 companion file');
    expect(text).toContain(
      `→ ${join('The Bear (2022) {tmdb-136315}', 'Season 03', 'The Bear (2022) - s03e04.mkv')}`,
    );
    expect(text).toContain('Ambiguous (needs validation) (1)');
    expect(text).toContain('Unrecognized (needs validation) (1)');
    expect(text).toContain('nothing found on TMDB');
    expect(text).toContain(
      'Summary: 0 in place, 2 to organize, 0 held back, 1 ambiguous, 1 unrecognized.',
    );
    expect(text).toContain('Read-only scan');
    expect(await readdir(dest)).toEqual([]);
    expect(h.err).toEqual([]);
  });

  it('organizes a library in place by default, with move as the mode', async () => {
    const lib = await makeDir();
    await put(join(lib, 'Dune.2021.mkv'));
    const h = await harness();
    expect(await h.cli('scan', lib)).toBe(0);
    expect(h.out.join('\n')).toContain('mode move');
    expect(h.out.join('\n')).toContain(`Destination: ${lib}`);
  });

  it('reports a file already in place as compliant', async () => {
    const lib = await makeDir();
    await put(join(lib, DUNE_DIR, 'Dune (2021) {tmdb-438631}.mkv'));
    const h = await harness();
    await h.cli('scan', lib);
    expect(h.out.join('\n')).toContain('Already in place (1)');
  });

  it('says so when there is nothing to scan', async () => {
    const h = await harness();
    expect(await h.cli('scan', await makeDir())).toBe(0);
    expect(h.out).toEqual(['No video files found.']);
  });

  it('shows the candidates of an ambiguous file', async () => {
    const src = await makeDir();
    await put(join(src, 'Dune.mkv'));
    const h = await harness();
    await h.cli('scan', src);
    const text = h.out.join('\n');
    expect(text).toContain('Dune (2021) · score');
    expect(text).toContain('Dune (1984) · score');
    expect(text).toContain('tmdb 438631');
  });

  it('holds back a file whose destination exists, saying why', async () => {
    const { src, dest } = await library();
    await put(join(dest, DUNE_DIR, 'Dune (2021) {tmdb-438631}.mkv'), 'taken');
    const h = await harness();
    await h.cli('scan', src, '--dest', dest);
    expect(h.out.join('\n')).toContain('Held back (1)');
    expect(h.out.join('\n')).toContain('the destination already exists');
  });
});

describe('process', () => {
  it('is a dry run unless --apply is given', async () => {
    const { src, dest } = await library();
    const h = await harness();
    expect(await h.cli('process', src, '--dest', dest)).toBe(0);
    expect(h.out.join('\n')).toContain('Dry run: nothing was written. Add --apply to execute.');
    expect(await readdir(dest)).toEqual([]);
    expect(await exists(join(src, 'Dune.2021.2160p.mkv'))).toBe(true);
  });

  it('organizes the files with --apply, sidecars included, and keeps the sources by default', async () => {
    const { src, dest } = await library();
    const h = await harness();

    expect(await h.cli('process', src, '--dest', dest, '--apply')).toBe(0);

    const folder = join(dest, DUNE_DIR);
    expect(await readFile(join(folder, 'Dune (2021) {tmdb-438631}.mkv'), 'utf8')).toBe('dune');
    expect(await readFile(join(folder, 'Dune (2021) {tmdb-438631}.en.srt'), 'utf8')).toBe('subs');
    expect(
      await readFile(
        join(dest, 'The Bear (2022) {tmdb-136315}', 'Season 03', 'The Bear (2022) - s03e04.mkv'),
        'utf8',
      ),
    ).toBe('bear');
    expect(await exists(join(src, 'Dune.2021.2160p.mkv'))).toBe(true);
    // The ambiguous and unrecognized files are left alone.
    expect(await exists(join(dest, 'zzqx.2020.mkv'))).toBe(false);
    const text = h.out.join('\n');
    expect(text).toMatch(/Batch .+: 3 done, 0 skipped, 0 failed\./);
    const batch = /Batch (\S+): 3 done/.exec(text)?.[1];
    expect(text).toContain(`kinoshelf undo ${batch} --apply`);
  });

  it('moves with --mode move', async () => {
    const { src, dest } = await library();
    const h = await harness();
    await h.cli('process', src, '--dest', dest, '--mode', 'move', '--apply');
    expect(await exists(join(src, 'Dune.2021.2160p.mkv'))).toBe(false);
    expect(await exists(join(dest, DUNE_DIR, 'Dune (2021) {tmdb-438631}.mkv'))).toBe(true);
  });

  it('handles a single file', async () => {
    const src = await makeDir();
    const dest = await makeDir();
    const file = await put(join(src, 'Dune.2021.mkv'), 'one');
    const h = await harness();
    expect(await h.cli('process', file, '--dest', dest, '--apply')).toBe(0);
    expect(await exists(join(dest, DUNE_DIR, 'Dune (2021) {tmdb-438631}.mkv'))).toBe(true);
  });

  it('sends movies and series to separate libraries', async () => {
    const { src } = await library();
    const [movies, shows] = [await makeDir(), await makeDir()];
    const h = await harness();
    await h.cli('process', src, '--dest-movies', movies, '--dest-series', shows, '--apply');
    expect(await readdir(movies)).toEqual([DUNE_DIR]);
    expect(await readdir(shows)).toEqual(['The Bear (2022) {tmdb-136315}']);
    expect(h.out.join('\n')).not.toContain('Destination:');
  });

  it('never overwrites, and reports it', async () => {
    const { src, dest } = await library();
    const existing = await put(join(dest, DUNE_DIR, 'Dune (2021) {tmdb-438631}.mkv'), 'mine');
    const h = await harness();
    expect(await h.cli('process', src, '--dest', dest, '--apply')).toBe(0);
    expect(await readFile(existing, 'utf8')).toBe('mine');
    expect(h.out.join('\n')).toContain('the destination already exists');
  });

  it('exits 1 when an operation fails', async () => {
    const src = await makeDir();
    const dest = await makeDir();
    await put(join(src, 'Dune.2021.mkv'));
    await put(join(dest, DUNE_DIR), 'a file where the folder should go');
    const h = await harness();
    expect(await h.cli('process', src, '--dest', dest, '--apply')).toBe(1);
    expect(h.out.join('\n')).toMatch(/0 done, 0 skipped, 1 failed/);
    expect(h.out.join('\n')).toContain('failed: File system error');
  });

  it('requires a destination', async () => {
    const src = await makeDir();
    await put(join(src, 'Dune.2021.mkv'));
    const h = await harness();
    expect(await h.cli('process', src)).toBe(1);
    expect(h.err.join('\n')).toContain('Give a destination with --dest');
  });

  it('reports a path that does not exist', async () => {
    const h = await harness();
    expect(await h.cli('process', '/nonexistent/kinoshelf', '--dest', '/tmp')).toBe(1);
    expect(h.err.join('\n')).toContain('Path not found: /nonexistent/kinoshelf');
  });
});

describe('undo', () => {
  it('has nothing to undo at first', async () => {
    const h = await harness();
    expect(await h.cli('undo')).toBe(0);
    expect(h.out).toEqual(['Nothing to undo.']);
  });

  it('previews, then reverts the last batch with --apply', async () => {
    const { src, dest } = await library();
    const h = await harness();
    await h.cli('process', src, '--dest', dest, '--apply');
    h.out.length = 0;

    expect(await h.cli('undo')).toBe(0);
    expect(h.out.join('\n')).toContain('Dry run: nothing was changed. Add --apply to revert.');
    expect(await exists(join(dest, DUNE_DIR, 'Dune (2021) {tmdb-438631}.mkv'))).toBe(true);

    h.out.length = 0;
    expect(await h.cli('undo', '--apply')).toBe(0);
    expect(h.out.join('\n')).toContain('3 reverted, 0 skipped, 0 failed.');
    expect(await readdir(dest)).toEqual([]);
    expect(await exists(join(src, 'Dune.2021.2160p.mkv'))).toBe(true);

    h.out.length = 0;
    await h.cli('undo', '--apply');
    expect(h.out).toEqual(['Nothing to undo.']);
  });

  describe('with a batch id', () => {
    /** The id printed when a batch is applied. */
    const batchOf = (out: string[]): string => {
      const id = /Batch (\S+): \d+ done/.exec(out.join('\n'))?.[1];
      if (!id) {
        throw new Error('no batch id in the output');
      }
      return id;
    };

    async function twoBatches() {
      const first = await library();
      const second = await makeDir();
      await put(join(second, 'Casablanca.1942.mkv'), 'casa');
      const h = await harness();
      await h.cli('process', first.src, '--dest', first.dest, '--apply');
      const one = batchOf(h.out);
      h.out.length = 0;
      await h.cli('process', second, '--dest', first.dest, '--apply');
      const two = batchOf(h.out);
      h.out.length = 0;
      return { h, dest: first.dest, one, two };
    }

    it('reverts that batch and leaves the more recent one', async () => {
      const { h, dest, one, two } = await twoBatches();
      expect(one).not.toBe(two);

      expect(await h.cli('undo', one)).toBe(0); // dry run
      expect(h.out.join('\n')).toContain(`Batch: ${one}`);
      expect(await exists(join(dest, DUNE_DIR, 'Dune (2021) {tmdb-438631}.mkv'))).toBe(true);

      h.out.length = 0;
      expect(await h.cli('undo', one, '--apply')).toBe(0);
      expect(h.out.join('\n')).toContain('3 reverted, 0 skipped, 0 failed.');
      expect(await exists(join(dest, DUNE_DIR, 'Dune (2021) {tmdb-438631}.mkv'))).toBe(false);
      expect(
        await exists(
          join(dest, 'Casablanca (1942) {tmdb-289}', 'Casablanca (1942) {tmdb-289}.mkv'),
        ),
      ).toBe(true);

      // Without an id, the most recent one that is left.
      h.out.length = 0;
      await h.cli('undo', '--apply');
      expect(h.out.join('\n')).toContain(`Batch: ${two}`);
      expect(await readdir(dest)).toEqual([]);
    });

    it('rejects an unknown id and an already reverted one as bad usage', async () => {
      const { h, one } = await twoBatches();
      expect(await h.cli('undo', 'nope')).toBe(2);
      expect(h.err).toEqual(['No batch nope in the journal.']);

      await h.cli('undo', one, '--apply');
      h.err.length = 0;
      expect(await h.cli('undo', one, '--apply')).toBe(2);
      expect(h.err).toEqual([`Batch ${one} was already reverted.`]);
      expect(await h.cli('--lang', 'fr', 'undo', one)).toBe(2);
      expect(h.err.at(-1)).toBe(`Le lot ${one} a déjà été annulé.`);
    });
  });

  it('puts moved files back', async () => {
    const { src, dest } = await library();
    const h = await harness();
    await h.cli('process', src, '--dest', dest, '--mode', 'move', '--apply');
    await h.cli('undo', '--apply');
    expect(await readFile(join(src, 'Dune.2021.2160p.mkv'), 'utf8')).toBe('dune');
    expect(await readdir(dest)).toEqual([]);
  });
});

describe('--json', () => {
  it('prints a parsable, language-neutral report', async () => {
    const { src, dest } = await library();
    const en = await harness({ LANG: 'en_US.UTF-8' });
    const fr = await harness({ LANG: 'fr_FR.UTF-8' });
    await en.cli('scan', src, '--dest', dest, '--json');
    await fr.cli('scan', src, '--dest', dest, '--json');

    const parsed = JSON.parse(en.out.join('\n')) as {
      dryRun: boolean;
      summary: Record<string, number>;
      entries: { classification: string; reason?: string; match?: { score: number } }[];
    };
    expect(parsed.dryRun).toBe(true);
    expect(parsed.summary).toMatchObject({ 'to-rename': 2, ambiguous: 1, unrecognized: 1 });
    expect(parsed.entries.find((e) => e.classification === 'unrecognized')?.reason).toBe(
      'no-candidates',
    );
    expect(parsed.entries.find((e) => e.classification === 'to-rename')?.match?.score).toBe(100);
    expect(fr.out.join('\n')).toBe(en.out.join('\n'));
  });

  it('includes the batch when applying, with error codes rather than text', async () => {
    const src = await makeDir();
    const dest = await makeDir();
    await put(join(src, 'Dune.2021.mkv'));
    await put(join(dest, DUNE_DIR), 'blocker');
    const h = await harness();
    expect(await h.cli('process', src, '--dest', dest, '--apply', '--json')).toBe(1);
    const parsed = JSON.parse(h.out.join('\n')) as {
      dryRun: boolean;
      batch: { items: { results: { status: string; error: { code: string } }[] }[] };
    };
    expect(parsed.dryRun).toBe(false);
    expect(parsed.batch.items[0]?.results[0]).toMatchObject({
      status: 'failed',
      error: { code: 'fs.error' },
    });
  });
});

describe('language', () => {
  it('speaks French with --lang fr, from the environment or from the config file', async () => {
    const { src, dest } = await library();

    const flagged = await harness();
    await flagged.cli('--lang', 'fr', 'scan', src, '--dest', dest);
    expect(flagged.out.join('\n')).toContain('Fichiers vidéo analysés : 4');
    expect(flagged.out.join('\n')).toContain('À ranger (2)');
    expect(flagged.out.join('\n')).toContain('Analyse en lecture seule');

    const fromEnv = await harness({ LANG: 'fr_FR.UTF-8' });
    await fromEnv.cli('scan', src, '--dest', dest);
    expect(fromEnv.out.join('\n')).toContain('Bilan :');

    const fromConfig = await harness();
    await put(join(fromConfig.configDir, 'config.yaml'), 'locale: fr\n');
    await fromConfig.cli('scan', src, '--dest', dest);
    expect(fromConfig.out.join('\n')).toContain('Bilan :');
  });

  it('translates errors and the help', async () => {
    const h = await harness();
    await h.cli('--lang', 'fr', 'undo', '--apply');
    expect(h.out).toEqual(['Rien à annuler.']);

    const failing = await harness();
    await failing.cli('--lang', 'fr', 'process', '/nonexistent/kinoshelf', '--dest', '/tmp');
    expect(failing.err.join('\n')).toContain('Chemin introuvable : /nonexistent/kinoshelf');

    const help = await harness();
    expect(await help.cli('--lang', 'fr', '--help')).toBe(0);
    expect(help.out.join('\n')).toContain('Identifie, renomme et enrichit');
    expect(help.out.join('\n')).toContain('Analyse une bibliothèque');
  });

  it('asks TMDB for titles in the language of the tool by default, and lets it be overridden', async () => {
    const src = await makeDir();
    await put(join(src, 'Dune.2021.mkv'));

    const fr = await harness();
    await fr.cli('--lang', 'fr', 'scan', src);
    expect(fr.languages).toEqual(['fr']);

    const en = await harness();
    await en.cli('scan', src);
    expect(en.languages).toEqual(['en-US']);

    const custom = await harness();
    await custom.cli('scan', src, '--metadata-language', 'de-DE');
    expect(custom.languages).toEqual(['de-DE']);
  });

  it('rejects an unknown --lang', async () => {
    const h = await harness();
    expect(await h.cli('--lang', 'klingon', 'undo')).toBe(2);
    expect(h.err.join('\n')).toContain('Invalid value "klingon" for --lang.');
  });
});

describe('options and configuration', () => {
  it.each([
    [['--mode', 'teleport'], 'Invalid value "teleport" for --mode.'],
    [['--threshold', 'high'], 'Invalid value "high" for --threshold.'],
    [['--threshold', '150'], 'Invalid value "150" for --threshold.'],
  ])('rejects %j with exit code 2', async (flags, message) => {
    const src = await makeDir();
    await put(join(src, 'Dune.2021.mkv'));
    const h = await harness();
    expect(await h.cli('scan', src, ...flags)).toBe(2);
    expect(h.err.join('\n')).toContain(message);
  });

  it('reports an unknown profile', async () => {
    const src = await makeDir();
    await put(join(src, 'Dune.2021.mkv'));
    const h = await harness();
    expect(await h.cli('scan', src, '--profile', 'nope')).toBe(1);
    expect(h.err.join('\n')).toContain('Unknown profile "nope".');
  });

  it('uses the config file for defaults, flags winning over it', async () => {
    const { src, dest } = await library();
    const h = await harness();
    await put(
      join(h.configDir, 'config.yaml'),
      `destination: ${dest}\nmode: hardlink\nthreshold: 100\n`,
    );

    await h.cli('scan', src);
    expect(h.out.join('\n')).toContain('mode hardlink');
    expect(h.out.join('\n')).toContain(`Destination: ${dest}`);

    h.out.length = 0;
    await h.cli('scan', src, '--mode', 'copy');
    expect(h.out.join('\n')).toContain('mode copy');
  });

  it('applies the threshold: a strict one holds back what a lax one accepts', async () => {
    const src = await makeDir();
    await put(join(src, 'Dune.mkv'));
    const lax = await harness();
    await lax.cli('scan', src, '--dest', await makeDir(), '--threshold', '50', '--json');
    const strict = await harness();
    await strict.cli('scan', src, '--dest', await makeDir(), '--threshold', '100', '--json');
    const classOf = (h: { out: string[] }) =>
      (JSON.parse(h.out.join('\n')) as { entries: { classification: string }[] }).entries[0]
        ?.classification;
    expect(classOf(lax)).toBe('to-rename');
    expect(classOf(strict)).toBe('ambiguous');
  });

  it('reports a broken config file in the right language', async () => {
    const h = await harness();
    await put(join(h.configDir, 'config.yaml'), 'mode: teleport\n');
    expect(await h.cli('--lang', 'fr', 'undo')).toBe(1);
    expect(h.err.join('\n')).toContain('Fichier de configuration invalide');
  });

  it('asks for a TMDB key when there is none, without leaking anything', async () => {
    const src = await makeDir();
    await put(join(src, 'Dune.2021.mkv'));
    const configDir = await makeDir();
    const err: string[] = [];
    // No `createProvider`: the real TMDB provider path, which needs a key.
    const code = await run(['--config-dir', configDir, 'scan', src], {
      env: { LANG: 'en_US.UTF-8', TMDB_API_KEY: '  ' },
      io: { out: () => undefined, err: (line) => err.push(line) },
    });
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('No TMDB API key. Set the TMDB_API_KEY environment variable');
    expect(err.join('\n')).toContain(join(configDir, 'config.yaml'));
  });

  it('shows progress only for terminals and never with --json', async () => {
    const src = await makeDir();
    await put(join(src, 'Dune.2021.mkv'));
    const seen: string[] = [];
    const h = await harness(
      {},
      {
        io: { out: () => undefined, err: () => undefined, progress: (text) => seen.push(text) },
      },
    );
    await h.cli('scan', src);
    expect(seen).toEqual(['1/1', '']);

    seen.length = 0;
    await h.cli('scan', src, '--json');
    expect(seen).toEqual(['']);
  });
});
