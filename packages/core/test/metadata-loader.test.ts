import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  analyze,
  discoverVideos,
  GuessitParser,
  loadBundledProfile,
  MetadataLoader,
  parseProfile,
  type ExternalId,
  type ParsedMedia,
  type Profile,
} from '../src/index.js';
import { FakeProvider, movie, series } from './fake-provider.js';
import { cleanup, makeDir, put } from './workspace.js';

afterEach(cleanup);

const WRITING = `
id: kodi
name: Kodi
episodeRangeSeparator: '-e'
templates:
  movieFolder: '{title} ({year})'
  movieFile: '{title} ({year})'
  seriesFolder: '{title}'
  seasonFolder: 'Season {season:02}'
  episodeFile: '{title} - s{season:02}e{episode:02}'
nfo: { format: kodi, movie: movie.nfo, episode: '{file}.nfo', series: tvshow.nfo }
artwork:
  - { kind: poster, name: poster.jpg }
  - { kind: fanart, name: fanart.jpg }
  - { kind: season-poster, name: 'season{season}-poster.jpg' }
filesystem: { forbidden: posix, replacement: '', maxSegmentBytes: 255 }
`;

const episode = (season: number, episodes: number[]): ParsedMedia => ({
  path: '/x.mkv',
  kind: 'episode',
  title: 'Show',
  season,
  episodes,
});

describe('MetadataLoader', () => {
  it('makes no request for a profile that writes nothing', async () => {
    const provider = new FakeProvider([movie(1, 'Dune', 2021)]);
    const loader = new MetadataLoader({ provider, profile: await loadBundledProfile('plex') });
    expect(loader.needsMetadata).toBe(false);
    expect(await loader.forCandidate(movie(1, 'Dune', 2021), episode(1, [1]))).toEqual({});
    expect(provider.calls).toEqual([]);
  });

  it('asks for the details of a movie', async () => {
    const provider = new FakeProvider([movie(1, 'Dune', 2021)]);
    const loader = new MetadataLoader({ provider, profile: parseProfile(WRITING) });
    const loaded = await loader.forCandidate(movie(1, 'Dune', 2021), episode(1, [1]));
    expect(loaded.details?.kind).toBe('movie');
    expect(loaded.episodes).toBeUndefined();
    expect(provider.calls.map((c) => c.method)).toEqual(['getMovieDetails']);
  });

  it('costs one details request and one season request for many episodes', async () => {
    const show = series(2, 'Show', 2008);
    const provider = new FakeProvider([show], {
      '2:1': {
        season: 1,
        episodes: [1, 2, 3, 4].map((n) => ({ season: 1, episode: n, title: `E${n}` })),
      },
    });
    const loader = new MetadataLoader({ provider, profile: parseProfile(WRITING) });
    const loaded = await Promise.all(
      [1, 2, 3, 4].map((n) => loader.forCandidate(show, episode(1, [n]))),
    );
    expect(loaded.map((l) => l.episodes?.map((e) => e.title))).toEqual([
      ['E1'],
      ['E2'],
      ['E3'],
      ['E4'],
    ]);
    expect(provider.calls.map((c) => c.method).sort()).toEqual(['getSeason', 'getSeriesDetails']);
  });

  it('returns the episodes of a multi-episode file', async () => {
    const show = series(2, 'Show', 2008);
    const provider = new FakeProvider([show], {
      '2:1': { season: 1, episodes: [1, 2, 3].map((n) => ({ season: 1, episode: n })) },
    });
    const loader = new MetadataLoader({ provider, profile: parseProfile(WRITING) });
    const loaded = await loader.forCandidate(show, episode(1, [2, 3]));
    expect(loaded.episodes?.map((e) => e.episode)).toEqual([2, 3]);
  });

  it('gives no companions when the provider does not know the work', async () => {
    const provider = new FakeProvider([]);
    const loader = new MetadataLoader({ provider, profile: parseProfile(WRITING) });
    expect(await loader.forCandidate(movie(9, 'Ghost', 2000), episode(1, [1]))).toEqual({});
    expect(await loader.forCandidate(series(9, 'Ghost'), episode(1, [1]))).toEqual({});
  });

  it('passes the language through and does not cache a failure', async () => {
    const show = series(2, 'Show', 2008);
    const languages: (string | undefined)[] = [];
    let fail = true;
    class Spy extends FakeProvider {
      override getSeriesDetails(id: ExternalId, language?: string) {
        languages.push(language);
        if (fail) {
          fail = false;
          return Promise.reject(new Error('network'));
        }
        return super.getSeriesDetails(id);
      }
      override getSeason(id: ExternalId, number: number, language?: string) {
        languages.push(language);
        return super.getSeason(id, number);
      }
    }
    const provider = new Spy([show]);
    const loader = new MetadataLoader({ provider, profile: parseProfile(WRITING), language: 'fr' });
    await expect(loader.forCandidate(show, episode(1, [1]))).rejects.toThrow('network');
    expect((await loader.forCandidate(show, episode(1, [1]))).details?.kind).toBe('series');
    expect(languages).toEqual(['fr', 'fr', 'fr']);
  });
});

describe('analyze with a profile that writes NFO and artwork', () => {
  const run = async (profile: Profile, names: string[]) => {
    const src = await makeDir();
    const lib = await makeDir();
    for (const name of names) {
      await put(join(src, name));
    }
    const provider = new FakeProvider(
      [movie(438631, 'Dune', 2021), series(1396, 'Breaking Bad', 2008)],
      {
        '1396:2': {
          season: 2,
          episodes: [1, 2, 3].map((n) => ({ season: 2, episode: n, title: `Ep ${n}` })),
        },
      },
      (query, candidate) =>
        query.title.toLowerCase().startsWith(candidate.title.toLowerCase().slice(0, 4)),
    );
    const result = await analyze(await discoverVideos(src), {
      parser: new GuessitParser(),
      provider,
      profile,
      destinationRoot: lib,
      mode: 'copy',
    });
    return { result, provider, lib };
  };

  const ops = (
    item: { operations: readonly { type: string; destination: string }[] } | undefined,
  ) => (item?.operations ?? []).filter((op) => op.type !== 'transfer');

  it('plans the NFO and the images of a movie', async () => {
    const { result, lib } = await run(parseProfile(WRITING), ['Dune.2021.2160p.mkv']);
    const item = result.plan.items[0];
    const written = ops(item).map((op) => [op.type, op.destination]);
    expect(written).toContainEqual(['write-file', join(lib, 'Dune (2021)', 'movie.nfo')]);
    expect(written).toContainEqual(['download', join(lib, 'Dune (2021)', 'poster.jpg')]);
    expect(written).toContainEqual(['download', join(lib, 'Dune (2021)', 'fanart.jpg')]);
  });

  it('plans one show NFO and one show poster for a batch of episodes', async () => {
    const { result, provider } = await run(parseProfile(WRITING), [
      'Breaking.Bad.S02E01.720p.mkv',
      'Breaking.Bad.S02E02.720p.mkv',
      'Breaking.Bad.S02E03.720p.mkv',
    ]);
    const all = result.plan.items.flatMap((item) => ops(item));
    const count = (name: string) => all.filter((op) => op.destination.endsWith(name)).length;
    expect(count('tvshow.nfo')).toBe(1);
    expect(
      all.filter((op) => op.destination.endsWith(join('Breaking Bad', 'poster.jpg'))),
    ).toHaveLength(1);
    expect(count('.nfo') - count('tvshow.nfo')).toBe(3);
    expect(provider.calls.filter((c) => c.method === 'getSeriesDetails')).toHaveLength(1);
  });

  it('plans nothing extra, and asks nothing, for a profile that writes nothing', async () => {
    const { result, provider } = await run(await loadBundledProfile('plex'), [
      'Dune.2021.2160p.mkv',
    ]);
    expect(result.plan.items[0]?.operations).toHaveLength(1);
    expect(provider.calls.some((c) => c.method.endsWith('Details'))).toBe(false);
  });
});
