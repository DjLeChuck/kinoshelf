import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  analyze,
  discoverVideos,
  isSample,
  GuessitParser,
  KinoshelfError,
  loadBundledProfile,
} from '../src/index.js';
import { FakeProvider, movie, season, series } from './fake-provider.js';
import { cleanup, makeDir, put } from './workspace.js';

afterEach(cleanup);

describe('discoverVideos', () => {
  it('finds videos recursively, skipping hidden, non-video files and symlinked folders', async () => {
    const root = await makeDir();
    const outside = await makeDir();
    await put(join(outside, 'escaped.mkv'));
    await put(join(root, 'Show', 'Season 1', 'e01.MKV'));
    await put(join(root, 'Show', 'Season 1', 'e01.srt'));
    await put(join(root, 'Film.mp4'));
    await put(join(root, '.hidden', 'x.mkv'));
    await put(join(root, '.Film.mp4.abc.kinoshelf-tmp'));
    await symlink(outside, join(root, 'link'));

    const found = await discoverVideos(root);
    expect(found.map((f) => f.displayPath)).toEqual([
      'Film.mp4',
      join('Show', 'Season 1', 'e01.MKV'),
    ]);
  });

  it('skips promotional samples shipped with a release', async () => {
    const root = await makeDir();
    await put(join(root, 'Film (2016)', 'Film.2016.1080p.mkv'));
    await put(join(root, 'Film (2016)', 'sample.avi'));
    await put(join(root, 'Film (2016)', 'Film.2016.1080p-sample.mkv'));
    await put(join(root, 'Film (2016)', 'Sample', 'proof.mkv'));
    await put(join(root, 'Sampler.2020.mkv'));
    const found = await discoverVideos(root);
    expect(found.map((f) => f.displayPath).sort()).toEqual([
      join('Film (2016)', 'Film.2016.1080p.mkv'),
      'Sampler.2020.mkv',
    ]);
  });

  it.each([
    ['sample.avi', true],
    ['Film.2016-SAMPLE.mkv', true],
    ['Film [sample].mkv', true],
    ['Sample/proof.mkv', true],
    ['movie/samples/a.mkv', true],
    ['Sampler.2020.mkv', false],
    ['Resampled.mkv', false],
    ['Film.2016.mkv', false],
  ])('isSample(%j) is %s', (path, expected) => {
    expect(isSample(path)).toBe(expected);
  });

  it('keeps the scanned folder name in the path given to the parser', async () => {
    const root = join(await makeDir(), 'Breaking Bad');
    await put(join(root, 'Season 2', '02x05.mkv'));
    const [file] = await discoverVideos(root);
    expect(file?.parserPath).toBe(join('Breaking Bad', 'Season 2', '02x05.mkv'));
    expect(file?.displayPath).toBe(join('Season 2', '02x05.mkv'));
  });

  it('accepts a single file', async () => {
    const dir = join(await makeDir(), 'Movies');
    const path = await put(join(dir, 'Dune.2021.mkv'));
    expect(await discoverVideos(path)).toEqual([
      { path, displayPath: 'Dune.2021.mkv', parserPath: join('Movies', 'Dune.2021.mkv') },
    ]);
  });

  it('ignores a single file that is not a video', async () => {
    expect(await discoverVideos(await put(join(await makeDir(), 'a.txt')))).toEqual([]);
  });

  it('reports a path that does not exist', async () => {
    await expect(discoverVideos('/nonexistent/kinoshelf')).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof KinoshelfError && error.info.code === 'discover.not-found',
    );
  });
});

describe('analyze', () => {
  it('classifies a whole folder, end to end', async () => {
    const src = await makeDir();
    const lib = await makeDir();
    await put(join(src, 'Dune.2021.2160p.UHD.BluRay.x265-GRP.mkv'));
    await put(join(src, 'Breaking.Bad.S02E05.720p.mkv'));
    await put(join(src, 'Casablanca.1942.mkv'));
    await put(join(src, 'zzqx.2020.mkv'));
    // Already in place in the library.
    await put(join(lib, 'Casablanca (1942) {tmdb-289}', 'Casablanca (1942) {tmdb-289}.mkv'));

    const provider = new FakeProvider(
      [
        movie(438631, 'Dune', 2021),
        movie(841, 'Dune', 1984),
        movie(289, 'Casablanca', 1942),
        series(1396, 'Breaking Bad', 2008),
      ],
      { '1396:2': season(2, [1, 2, 3, 4, 5, 6]) },
      (query, candidate) =>
        query.title.toLowerCase().includes(candidate.title.toLowerCase().slice(0, 4)),
    );

    const progress: number[] = [];
    const result = await analyze(await discoverVideos(src), {
      parser: new GuessitParser(),
      provider,
      profile: await loadBundledProfile('plex'),
      destinationRoot: lib,
      mode: 'copy',
      onProgress: (done) => progress.push(done),
    });

    const entry = (name: string) => result.entries.find((e) => e.file.displayPath.startsWith(name));
    expect(entry('Dune')?.classification).toBe('to-rename');
    expect(entry('Dune')?.item?.operations[0]).toMatchObject({
      destination: join(lib, 'Dune (2021) {tmdb-438631}', 'Dune (2021) {tmdb-438631}.mkv'),
    });
    expect(entry('Breaking')?.classification).toBe('to-rename');
    expect(entry('Casablanca')?.classification).toBe('conflict'); // its destination is taken
    expect(entry('zzqx')?.classification).toBe('unrecognized');
    expect(result.plan.items).toHaveLength(3);
    expect(progress).toHaveLength(4);
    expect(progress.at(-1)).toBe(4);
  });

  it('reports a file already in the library as compliant', async () => {
    const lib = await makeDir();
    const path = await put(join(lib, 'Dune (2021) {tmdb-438631}', 'Dune (2021) {tmdb-438631}.mkv'));
    const result = await analyze(await discoverVideos(lib), {
      parser: new GuessitParser(),
      provider: new FakeProvider([movie(438631, 'Dune', 2021)]),
      profile: await loadBundledProfile('plex'),
      destinationRoot: lib,
      mode: 'move',
    });
    expect(result.entries.map((e) => [e.file.path, e.classification])).toEqual([
      [path, 'compliant'],
    ]);
  });

  it('flags two same-titled movies without a year as ambiguous', async () => {
    const src = await makeDir();
    await put(join(src, 'Dune.1080p.mkv'));
    const result = await analyze(await discoverVideos(src), {
      parser: new GuessitParser(),
      provider: new FakeProvider([movie(1, 'Dune', 2021), movie(2, 'Dune', 1984)]),
      profile: await loadBundledProfile('plex'),
      destinationRoot: await makeDir(),
      mode: 'copy',
    });
    expect(result.entries[0]?.classification).toBe('ambiguous');
    expect(result.plan.items).toEqual([]);
  });

  it('keeps results in file order whatever the concurrency', async () => {
    const src = await makeDir();
    for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) {
      await put(join(src, `${n}.mkv`));
    }
    const result = await analyze(await discoverVideos(src), {
      parser: new GuessitParser(),
      provider: new FakeProvider([]),
      profile: await loadBundledProfile('plex'),
      destinationRoot: await makeDir(),
      mode: 'copy',
      concurrency: 3,
    });
    expect(result.entries.map((e) => e.file.displayPath)).toEqual([
      'a.mkv',
      'b.mkv',
      'c.mkv',
      'd.mkv',
      'e.mkv',
      'f.mkv',
    ]);
  });

  it('plans from the absolute path even though the parser saw a relative one', async () => {
    const root = await makeDir();
    const path = await put(join(root, 'Movies', 'Dune.2021.mkv'));
    await mkdir(join(root, 'lib'));
    const result = await analyze(await discoverVideos(join(root, 'Movies')), {
      parser: new GuessitParser(),
      provider: new FakeProvider([movie(438631, 'Dune', 2021)]),
      profile: await loadBundledProfile('plex'),
      destinationRoot: join(root, 'lib'),
      mode: 'copy',
    });
    expect(result.entries[0]?.parsed.path).toBe(path);
    expect(result.plan.items[0]?.operations[0]).toMatchObject({ source: path });
  });
});
