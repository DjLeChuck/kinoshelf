import { chmod, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, harness, makeDir, put } from './helpers.js';

afterEach(cleanup);

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

/** A movie library with a leftover folder and a movie another tool dressed. */
async function setup() {
  const films = await makeDir();
  const series = await makeDir();
  const arrivals = await makeDir();
  const dune = join(films, 'Dune (2021)');
  await put(join(dune, 'Dune (2021).mkv'), 'video');
  await put(join(dune, 'Dune (2021)-poster.jpg'), 'poster');
  await put(join(dune, 'Dune (2021).nfo'), 'nfo');
  await put(join(films, 'Alien (1979)', 'movie.nfo'), 'nfo');
  await put(join(arrivals, 'Empty', 'x.jpg'));
  const h = await harness();
  await put(
    join(h.configDir, 'config.yaml'),
    [
      'libraries:',
      `  - { id: films, name: Films, type: movie, source: ${films} }`,
      `  - { id: shows, name: Shows, type: series, source: ${series} }`,
      `  - { id: arrivals, name: Arrivals, into: { movie: films, series: shows }, source: ${arrivals} }`,
      '',
    ].join('\n'),
  );
  return { h, films, arrivals, dune };
}

describe('tidy', () => {
  it('reports the folders with no video and the metadata named after a video, and changes nothing', async () => {
    const { h, films, dune } = await setup();

    expect(await h.cli('tidy')).toBe(0);

    const text = h.out.join('\n');
    expect(text).toContain(`Library films (movie): ${films}`);
    expect(text).toContain(join(films, 'Alien (1979)'));
    expect(text).toContain('1 file ·');
    expect(text).toContain(join(dune, 'Dune (2021)-poster.jpg'));
    expect(text).toContain('Kinoshelf writes poster.jpg, not there yet');
    expect(text).toContain('1 folder with no video, 2 files named after a video.');
    expect(text).toContain('Read-only report: nothing was changed.');
    expect(await exists(join(films, 'Alien (1979)', 'movie.nfo'))).toBe(true);
    expect(await exists(join(dune, 'Dune (2021)-poster.jpg'))).toBe(true);
  });

  it('never reads an arrival folder', async () => {
    const { h, arrivals } = await setup();

    await h.cli('tidy');

    expect(h.out.join('\n')).not.toContain(arrivals);
  });

  it('prints codes and data with --json', async () => {
    const { h, films } = await setup();

    expect(await h.cli('tidy', '--json')).toBe(0);

    const json = JSON.parse(h.out.join('\n')) as {
      readOnly: boolean;
      libraries: { library: { id: string }; orphanFolders: { path: string }[] }[];
    };
    expect(json.readOnly).toBe(true);
    expect(json.libraries.map(({ library }) => library.id)).toEqual(['films', 'shows']);
    expect(json.libraries[0]?.orphanFolders.map(({ path }) => path)).toEqual([
      join(films, 'Alien (1979)'),
    ]);
  });

  it('says so when there is nothing to tidy', async () => {
    const films = await makeDir();
    await put(join(films, 'Dune (2021)', 'Dune (2021).mkv'));
    const h = await harness();
    await put(
      join(h.configDir, 'config.yaml'),
      `libraries:\n  - { id: films, name: Films, type: movie, source: ${films} }\n`,
    );

    expect(await h.cli('tidy')).toBe(0);

    expect(h.out.join('\n')).toContain('Nothing to tidy.');
  });

  it('reads one library with --library, and refuses an unknown one or an arrival folder', async () => {
    const { h } = await setup();

    expect(await h.cli('tidy', '--library', 'films')).toBe(0);
    expect(await h.cli('tidy', '--library', 'arrivals')).toBe(2);
    expect(h.err.join('\n')).toContain(
      'No library "arrivals" in config.yaml (libraries: films, shows).',
    );
  });

  it('asks for a typed library when there is none', async () => {
    const h = await harness();

    expect(await h.cli('tidy')).toBe(2);

    expect(h.err.join('\n')).toContain('No library with a type');
  });

  it('speaks French', async () => {
    const { h } = await setup();

    expect(await h.cli('--lang', 'fr', 'tidy')).toBe(0);

    expect(h.out.join('\n')).toContain('Rapport en lecture seule : rien n’a été modifié.');
  });
});

describe('tidy --folders', () => {
  /** The leftover folder of a former tool, next to the renamed one. */
  async function withTwin() {
    const ctx = await setup();
    await put(join(ctx.films, 'Dune (2021) - 1080p', 'Dune (2021)-poster.jpg'), 'poster');
    return ctx;
  }

  it('is a dry run without --apply: it says what would go and what stays, and moves nothing', async () => {
    const { h, films } = await withTwin();

    expect(await h.cli('tidy', '--folders')).toBe(0);

    const text = h.out.join('\n');
    expect(text).toContain('would take out · 1 file · same work as Dune (2021)');
    expect(text).toContain('no folder with a video bears the same name');
    expect(text).toContain('Dry run: nothing was moved');
    expect(text).toContain('1 folder to take out');
    expect(text).not.toContain('select');
    expect(await exists(join(films, 'Dune (2021) - 1080p', 'Dune (2021)-poster.jpg'))).toBe(true);
  });

  it('takes the folder out with --apply, names the batch, and undo brings it back', async () => {
    const { h, films } = await withTwin();

    expect(await h.cli('tidy', '--folders', '--apply')).toBe(0);

    const text = h.out.join('\n');
    expect(text).toContain('taken out · 1 file');
    const batch = /kinoshelf undo (\S+) --apply/.exec(text)?.[1];
    expect(batch).toBeDefined();
    expect(await exists(join(films, 'Dune (2021) - 1080p'))).toBe(false);
    expect(await exists(join(films, 'Alien (1979)', 'movie.nfo'))).toBe(true);

    h.out.length = 0;
    expect(await h.cli('undo', batch ?? '', '--apply')).toBe(0);
    expect(await exists(join(films, 'Dune (2021) - 1080p', 'Dune (2021)-poster.jpg'))).toBe(true);
  });
});

describe('tidy dry runs', () => {
  it('open no database: they work on a config folder that cannot be written', async () => {
    const { h } = await setup();
    await chmod(h.configDir, 0o500);
    try {
      expect(await h.cli('tidy', '--folders')).toBe(0);
      expect(await h.cli('tidy', '--files')).toBe(0);
    } finally {
      await chmod(h.configDir, 0o700);
    }
    expect(await exists(join(h.configDir, 'kinoshelf.sqlite'))).toBe(false);
  });
});

describe('tidy --files', () => {
  it('is a dry run without --apply, and leaves the NFO unless --with-nfo is given', async () => {
    const { h, dune } = await setup();

    expect(await h.cli('tidy', '--files')).toBe(0);

    const text = h.out.join('\n');
    expect(text).toContain('would rename to poster.jpg');
    expect(text).toContain('add --with-nfo to handle NFO files');
    expect(text).toContain('Dry run: nothing was changed');
    expect(await exists(join(dune, 'Dune (2021)-poster.jpg'))).toBe(true);
  });

  it('renames the poster with --apply and undo puts it back', async () => {
    const { h, dune } = await setup();

    expect(await h.cli('tidy', '--files', '--apply')).toBe(0);

    const batch = /kinoshelf undo (\S+) --apply/.exec(h.out.join('\n'))?.[1];
    expect(await exists(join(dune, 'poster.jpg'))).toBe(true);
    expect(await exists(join(dune, 'Dune (2021).nfo'))).toBe(true);

    expect(await h.cli('undo', batch ?? '', '--apply')).toBe(0);
    expect(await exists(join(dune, 'Dune (2021)-poster.jpg'))).toBe(true);
    expect(await exists(join(dune, 'poster.jpg'))).toBe(false);
  });
});

describe('tidy --subtitles', () => {
  async function withSubs() {
    const s = await setup();
    await put(join(s.dune, 'Subs', '2_French.srt'), 'fr');
    await put(join(s.dune, 'Subs', '3_French.srt'), 'again');
    await put(join(s.dune, 'Subs', 'Dune.srt'), 'unknown');
    return s;
  }

  it('is a dry run without --apply, and says which files stay and why', async () => {
    const { h, dune } = await withSubs();

    expect(await h.cli('tidy', '--subtitles')).toBe(0);

    const text = h.out.join('\n');
    expect(text).toContain('would go to Dune (2021).fr.srt');
    expect(text).toContain('stays in its folder (that language is already taken)');
    expect(text).toContain('stays in its folder (no language in its name)');
    expect(text).toContain('Dry run: nothing was moved');
    expect(await exists(join(dune, 'Subs', '2_French.srt'))).toBe(true);
  });

  it('moves them with --apply and undo puts them back', async () => {
    const { h, dune } = await withSubs();

    expect(await h.cli('tidy', '--subtitles', '--apply')).toBe(0);

    const batch = /kinoshelf undo (\S+) --apply/.exec(h.out.join('\n'))?.[1];
    expect(await exists(join(dune, 'Dune (2021).fr.srt'))).toBe(true);
    expect(await exists(join(dune, 'Subs', '2_French.srt'))).toBe(false);
    // The two that stay keep their folder.
    expect(await exists(join(dune, 'Subs', 'Dune.srt'))).toBe(true);

    expect(await h.cli('undo', batch ?? '', '--apply')).toBe(0);
    expect(await exists(join(dune, 'Subs', '2_French.srt'))).toBe(true);
    expect(await exists(join(dune, 'Dune (2021).fr.srt'))).toBe(false);
  });

  it('carries codes in the JSON, not text', async () => {
    const { h } = await withSubs();
    expect(await h.cli('tidy', '--subtitles', '--json')).toBe(0);
    const report = JSON.parse(h.out.join('\n')) as {
      libraries: { id: string; left: { reason: string }[] }[];
    };
    expect(report.libraries.find(({ id }) => id === 'films')?.left.map((l) => l.reason)).toEqual([
      'language-taken',
      'language-unknown',
    ]);
  });
});
