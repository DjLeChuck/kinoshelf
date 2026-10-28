import { KinoshelfError } from '@kinoshelf/core';
import { describe, expect, it } from 'vitest';
import { MemoryCache, TmdbProvider, type CacheEntry } from '../src/index.js';
import { at, fakeFetch, fixtureJson, json, tmdbRoutes } from './helpers.js';

const BEARER = 'eyJhbGciOiJIUzI1NiJ9.payload.signature';
const V3_KEY = '0123456789abcdef0123456789abcdef';

const noSleep = (): Promise<void> => Promise.resolve();

function make(
  routes = tmdbRoutes,
  extra: Partial<ConstructorParameters<typeof TmdbProvider>[0]> = {},
) {
  const double = fakeFetch(routes);
  const provider = new TmdbProvider({
    apiKey: BEARER,
    fetch: double.fetch,
    sleep: noSleep,
    ...extra,
  });
  return { provider, requests: double.requests };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof KinoshelfError ? error.info.code : 'unexpected';
  }
  return undefined;
}

interface RawMovieSearch {
  results: { id: number; title: string; overview?: string | null }[];
}

describe('searchMovies', () => {
  it('sends the query, year and language', async () => {
    const { provider, requests } = make();
    await provider.searchMovies({ title: 'Dune', year: 2021, language: 'fr' });

    const search = requests.find((r) => r.url.pathname === '/3/search/movie');
    expect(Object.fromEntries(search?.url.searchParams ?? [])).toEqual({
      query: 'Dune',
      year: '2021',
      language: 'fr',
      include_adult: 'false',
    });
  });

  it('maps a real result, with alternative titles that add to the known ones', async () => {
    const { provider } = make();
    const results = await provider.searchMovies({ title: 'Dune', year: 2021 });

    const dune = results.find((r) => r.id.id === 438631);
    expect(dune).toMatchObject({
      kind: 'movie',
      id: { provider: 'tmdb', id: 438631 },
      title: 'Dune',
      originalTitle: 'Dune',
      year: 2021,
    });
    expect(dune?.alternativeTitles).toContain('Dune - Première partie');
    expect(dune?.alternativeTitles).not.toContain('Dune'); // already the title
    expect(new Set(dune?.alternativeTitles).size).toBe(dune?.alternativeTitles.length); // no dups
    expect(dune?.posterPath).toMatch(/^\/.+\.jpg$/);
    expect(typeof dune?.popularity).toBe('number');
    expect(results.find((r) => r.id.id === 841)).toMatchObject({ year: 1984 });
  });

  it('leaves out an empty synopsis rather than reporting an empty string', async () => {
    const { provider } = make();
    const results = await provider.searchMovies({ title: 'Dune', year: 2021 });
    const raw = (fixtureJson('search-movie-dune-2021.json') as RawMovieSearch).results;
    const empty = raw.filter((r) => !r.overview);

    expect(empty.length).toBeGreaterThan(0); // the recording contains such results
    for (const { id } of empty) {
      expect(results.find((r) => r.id.id === id)).not.toHaveProperty('overview');
    }
  });

  it('does not send a year when none is given', async () => {
    const { provider, requests } = make();
    await provider.searchMovies({ title: 'Dune' });
    expect(requests[0]?.url.searchParams.has('year')).toBe(false);
  });

  it('fetches alternative titles only for the best-ranked candidates', async () => {
    const { provider, requests } = make();
    const results = await provider.searchMovies({ title: 'Dune', year: 2021 });

    expect(requests.filter((r) => r.url.pathname.endsWith('/alternative_titles'))).toHaveLength(5);
    expect(results.length).toBeGreaterThan(5);
    expect(results[5]?.alternativeTitles).toEqual([]);

    const few = make(tmdbRoutes, { alternativeTitlesFor: 1 });
    const fewResults = await few.provider.searchMovies({ title: 'Dune', year: 2021 });
    expect(few.requests.filter((r) => r.url.pathname.endsWith('/alternative_titles'))).toHaveLength(
      1,
    );
    expect(fewResults[1]?.alternativeTitles).toEqual([]);
  });

  it('uses the default language when the query has none', async () => {
    const { provider, requests } = make(tmdbRoutes, { language: 'fr-FR' });
    await provider.searchMovies({ title: 'Dune' });
    expect(requests[0]?.url.searchParams.get('language')).toBe('fr-FR');
  });

  // Synthetic: TMDB cannot be asked for these shapes on demand.
  describe('sparse results', () => {
    const sparse = make([
      at('/3/search/movie', () =>
        json(
          JSON.stringify({
            results: [
              {
                id: 7,
                title: 'No Date',
                original_title: 'No Date',
                release_date: '',
                poster_path: null,
              },
              { id: 8, title: 'Null Date', original_title: 'Null Date', release_date: null },
            ],
          }),
        ),
      ),
      at('/3/movie/7/alternative_titles', () => json('{"success":false}', 404)),
      at('/3/movie/8/alternative_titles', () => json('{"id":8,"titles":[]}')),
    ]);

    it('omits year and poster when absent and tolerates a 404 on alternative titles', async () => {
      const results = await sparse.provider.searchMovies({ title: 'x' });
      expect(results).toHaveLength(2);
      for (const result of results) {
        expect(result).not.toHaveProperty('year');
        expect(result).not.toHaveProperty('posterPath');
        expect(result.alternativeTitles).toEqual([]);
      }
    });
  });
});

describe('searchSeries', () => {
  it('maps real results using the TV field names and first_air_date_year', async () => {
    const { provider, requests } = make();
    const results = await provider.searchSeries({ title: 'The Bear', year: 2022 });

    expect(requests[0]?.url.searchParams.get('first_air_date_year')).toBe('2022');
    const bear = results.find((r) => r.id.id === 136315);
    expect(bear).toMatchObject({
      kind: 'series',
      id: { provider: 'tmdb', id: 136315 },
      title: 'The Bear',
      originalTitle: 'The Bear',
      year: 2022,
    });
    expect(bear?.alternativeTitles).toContain('The Bear : Sur place ou à emporter');
    expect(bear?.alternativeTitles).not.toContain('The Bear');
  });

  it('reports the countries of origin of a series', async () => {
    const { provider } = make();
    const results = await provider.searchSeries({ title: 'The Bear', year: 2022 });
    expect(results.find((r) => r.id.id === 136315)?.countries).toEqual(['US']);
  });

  it('omits the countries when TMDB gives none, as for movies (synthetic)', async () => {
    const { provider } = make([
      at('/3/search/tv', () =>
        json(
          JSON.stringify({
            results: [
              { id: 1, name: 'A', original_name: 'A', origin_country: [] },
              { id: 2, name: 'B', original_name: 'B' },
            ],
          }),
        ),
      ),
      at('/3/tv/1/alternative_titles', () => json('{"id":1,"results":[]}')),
      at('/3/tv/2/alternative_titles', () => json('{"id":2,"results":[]}')),
    ]);
    const results = await provider.searchSeries({ title: 'x' });
    for (const result of results) {
      expect(result).not.toHaveProperty('countries');
    }
    const movies = await make().provider.searchMovies({ title: 'Dune', year: 2021 });
    expect(movies[0]).not.toHaveProperty('countries');
  });

  it('keeps the localized and original names apart', async () => {
    const { provider } = make();
    const results = await provider.searchSeries({ title: 'The Bear', year: 2022 });
    const foreign = results.find((r) => r.title !== r.originalTitle);
    expect(foreign).toBeDefined();
  });
});

describe('getSeason', () => {
  it('maps a real season', async () => {
    const { provider } = make();
    const season = await provider.getSeason({ provider: 'tmdb', id: 136315 }, 3);

    expect(season?.season).toBe(3);
    expect(season?.episodes.map((e) => e.episode)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(season?.episodes.every((e) => e.season === 3)).toBe(true);
    expect(season?.episodes[3]).toMatchObject({ episode: 4, title: 'Violet' });
    expect(season?.episodes.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.airDate ?? ''))).toBe(true);
  });

  it('returns null when the season does not exist (a real 404)', async () => {
    const { provider } = make();
    expect(await provider.getSeason({ provider: 'tmdb', id: 136315 }, 99)).toBeNull();
  });

  it('drops empty names and null air dates (synthetic)', async () => {
    const { provider } = make([
      at('/3/tv/1/season/1', () =>
        json(
          JSON.stringify({
            season_number: 1,
            episodes: [
              { season_number: 1, episode_number: 1, name: '', air_date: null },
              { season_number: 1, episode_number: 2, name: 'Two', air_date: '2020-01-02' },
            ],
          }),
        ),
      ),
    ]);
    const season = await provider.getSeason({ provider: 'tmdb', id: 1 }, 1);
    expect(season?.episodes).toEqual([
      { season: 1, episode: 1 },
      { season: 1, episode: 2, title: 'Two', airDate: '2020-01-02' },
    ]);
  });

  it('rejects an id from another provider', async () => {
    const { provider } = make();
    expect(await codeOf(provider.getSeason({ provider: 'tvdb', id: 1 }, 1))).toBe(
      'provider.foreign-id',
    );
  });
});

describe('caching', () => {
  it('serves a repeated request from the cache, including a 404', async () => {
    const { provider, requests } = make();
    const id = { provider: 'tmdb', id: 136315 };
    await provider.getSeason(id, 3);
    await provider.getSeason(id, 3);
    await provider.getSeason(id, 99);
    await provider.getSeason(id, 99);
    expect(requests).toHaveLength(2);
  });

  it('refetches once the entry has expired', async () => {
    let now = 0;
    const { provider, requests } = make(tmdbRoutes, { now: () => now, cache: new MemoryCache() });
    const id = { provider: 'tmdb', id: 136315 };
    await provider.getSeason(id, 3);
    now = 24 * 60 * 60 * 1000 + 1;
    await provider.getSeason(id, 3);
    expect(requests).toHaveLength(2);
  });

  it('distinguishes requests that differ only by language', async () => {
    const { provider, requests } = make();
    const id = { provider: 'tmdb', id: 136315 };
    await provider.getSeason(id, 3, 'fr');
    await provider.getSeason(id, 3, 'en');
    expect(requests).toHaveLength(2);
  });
});

describe('authentication', () => {
  it('sends a v4 token as a Bearer header and keeps it out of the URL', async () => {
    const { provider, requests } = make();
    await provider.getSeason({ provider: 'tmdb', id: 136315 }, 3);
    expect(requests[0]?.headers.get('authorization')).toBe(`Bearer ${BEARER}`);
    expect(requests[0]?.url.searchParams.has('api_key')).toBe(false);
  });

  it('sends a v3 key as api_key and never stores it in the cache key', async () => {
    class SpyCache extends MemoryCache {
      readonly keys: string[] = [];
      override set(key: string, entry: CacheEntry, expiresAt: number): void {
        this.keys.push(key);
        super.set(key, entry, expiresAt);
      }
    }
    const cache = new SpyCache();
    const { provider, requests } = make(tmdbRoutes, { apiKey: V3_KEY, cache });
    await provider.getSeason({ provider: 'tmdb', id: 136315 }, 3);
    expect(requests[0]?.url.searchParams.get('api_key')).toBe(V3_KEY);
    expect(requests[0]?.headers.has('authorization')).toBe(false);
    expect(cache.keys).toHaveLength(1);
    expect(cache.keys.join()).not.toContain(V3_KEY);
  });

  it('reports a rejected key without echoing it', async () => {
    const { provider } = make([() => json('{}', 401)], { apiKey: V3_KEY });
    try {
      await provider.searchMovies({ title: 'x' });
      expect.unreachable();
    } catch (error) {
      expect((error as KinoshelfError).info).toEqual({ code: 'tmdb.invalid-key' });
    }
  });
});

describe('failures and retries', () => {
  it('waits for Retry-After on a 429, then succeeds', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const { provider } = make(
      [
        at('/3/tv/136315/season/3', () => {
          calls += 1;
          return calls === 1
            ? new Response('slow down', { status: 429, headers: { 'retry-after': '2' } })
            : json('{"season_number":3,"episodes":[]}');
        }),
      ],
      {
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      },
    );
    const season = await provider.getSeason({ provider: 'tmdb', id: 136315 }, 3);
    expect(season?.season).toBe(3);
    expect(sleeps).toEqual([2000]);
  });

  it('gives up with tmdb.rate-limited after the retries', async () => {
    const { provider, requests } = make([() => new Response('', { status: 429 })]);
    expect(await codeOf(provider.searchMovies({ title: 'x' }))).toBe('tmdb.rate-limited');
    expect(requests).toHaveLength(4);
  });

  it('retries 5xx with exponential backoff, then reports the status', async () => {
    const sleeps: number[] = [];
    const { provider } = make([() => new Response('', { status: 503 })], {
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    try {
      await provider.searchMovies({ title: 'x' });
      expect.unreachable();
    } catch (error) {
      expect((error as KinoshelfError).info.code).toBe('tmdb.http-error');
      expect((error as KinoshelfError).info.params).toMatchObject({ status: 503 });
    }
    expect(sleeps).toEqual([500, 1000, 2000]);
  });

  it('does not retry other 4xx', async () => {
    const { provider, requests } = make([() => json('{}', 422)]);
    expect(await codeOf(provider.searchMovies({ title: 'x' }))).toBe('tmdb.http-error');
    expect(requests).toHaveLength(1);
  });

  it('reports network failures after retrying', async () => {
    let calls = 0;
    const provider = new TmdbProvider({
      apiKey: BEARER,
      sleep: noSleep,
      fetch: () => {
        calls += 1;
        return Promise.reject(new TypeError('fetch failed'));
      },
    });
    expect(await codeOf(provider.searchMovies({ title: 'x' }))).toBe('tmdb.network');
    expect(calls).toBe(4);
  });

  it('rejects a response that does not match the expected shape', async () => {
    const { provider } = make([() => json('{"results":[{"id":"nope"}]}')]);
    expect(await codeOf(provider.searchMovies({ title: 'x' }))).toBe('tmdb.invalid-response');
  });

  it('rejects a body that is not JSON', async () => {
    const { provider } = make([() => new Response('<html>', { status: 200 })]);
    expect(await codeOf(provider.searchMovies({ title: 'x' }))).toBe('tmdb.invalid-response');
  });
});

describe('concurrency', () => {
  it('never exceeds the configured number of simultaneous requests', async () => {
    let inFlight = 0;
    let peak = 0;
    const provider = new TmdbProvider({
      apiKey: BEARER,
      concurrency: 2,
      alternativeTitlesFor: 0,
      sleep: noSleep,
      fetch: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return json('{"season_number":1,"episodes":[]}');
      },
    });
    await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) => provider.getSeason({ provider: 'tmdb', id: n }, 1)),
    );
    expect(peak).toBe(2);
  });
});
