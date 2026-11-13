import { lstat } from 'node:fs/promises';
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
