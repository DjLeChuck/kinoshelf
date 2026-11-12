import { KinoshelfError } from '@kinoshelf/core';
import { describe, expect, it } from 'vitest';
import { MemoryCache, RequestPool, TmdbProvider, type CacheEntry } from '../src/index.js';
import { at, fakeFetch, fixture, fixtureJson, json, tmdbRoutes } from './helpers.js';

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

  it('reads what an episode file needs (synthetic: the recording is trimmed of crew)', async () => {
    const { provider } = make([
      at('/3/tv/1/season/1', () =>
        json(
          JSON.stringify({
            season_number: 1,
            episodes: [
              {
                season_number: 1,
                episode_number: 1,
                name: 'One',
                overview: 'It begins.',
                runtime: 42,
                still_path: '/still.jpg',
                vote_average: 7.5,
                vote_count: 12,
                crew: [
                  { name: 'Ann', job: 'Director' },
                  { name: 'Bob', job: 'Writer' },
                  { name: 'Bob', job: 'Screenplay' },
                  { name: 'Cy', job: 'Editor' },
                ],
              },
              {
                season_number: 1,
                episode_number: 2,
                overview: '',
                runtime: 0,
                still_path: null,
                vote_average: 0,
                vote_count: 0,
                crew: [],
              },
            ],
          }),
        ),
      ),
    ]);
    const season = await provider.getSeason({ provider: 'tmdb', id: 1 }, 1);
    expect(season?.episodes).toEqual([
      {
        season: 1,
        episode: 1,
        title: 'One',
        overview: 'It begins.',
        runtime: 42,
        directors: ['Ann'],
        writers: ['Bob'],
        rating: { value: 7.5, votes: 12 },
        stillPath: '/still.jpg',
      },
      { season: 1, episode: 2 },
    ]);
  });

  it('maps the overview, runtime, still and rating of a real season', async () => {
    const { provider } = make();
    const season = await provider.getSeason({ provider: 'tmdb', id: 136315 }, 3);
    expect(season?.episodes[0]).toMatchObject({
      overview: 'The next day and the days that led to it.',
      runtime: 37,
      stillPath: '/ihAiadFBWBY4sewnHrgOQCJ2shk.jpg',
      rating: { value: 7.6, votes: 78 },
    });
  });

  it('rejects an id from another provider', async () => {
    const { provider } = make();
    expect(await codeOf(provider.getSeason({ provider: 'tvdb', id: 1 }, 1))).toBe(
      'provider.foreign-id',
    );
  });
});

describe('getMovieDetails and getSeriesDetails', () => {
  // Hand-written fixtures, see fixtures/README.md.
  const movieId = { provider: 'tmdb', id: 438631 };
  const tvId = { provider: 'tmdb', id: 136315 };
  const detailRoutes = [
    at('/3/movie/438631', () => json(fixture('details-movie-438631.json'))),
    at('/3/tv/136315', () => json(fixture('details-tv-136315.json'))),
    // The fixtures list no logo, so the details ask for the images of every language: none there.
    at('/3/movie/438631/images', () => json('{"posters":[],"backdrops":[],"logos":[]}')),
    at('/3/tv/136315/images', () => json('{"posters":[],"backdrops":[],"logos":[]}')),
    at('/3/movie/404', () => json('{"success":false,"status_code":34}', 404)),
    at('/3/tv/404', () => json('{"success":false,"status_code":34}', 404)),
  ];

  it('maps a movie from a single request', async () => {
    const { provider, requests: all } = make(detailRoutes);
    const movie = await provider.getMovieDetails(movieId, 'fr');
    const requests = all.filter((request) => request.url.pathname === '/3/movie/438631');

    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(requests[0]?.url.searchParams ?? [])).toEqual({
      language: 'fr',
      append_to_response: 'credits,external_ids,keywords,release_dates,images',
      include_image_language: 'fr,en,null',
    });
    expect(movie).toMatchObject({
      kind: 'movie',
      id: { provider: 'tmdb', id: 438631 },
      imdbId: 'tt1160419',
      title: 'Dune',
      originalTitle: 'Dune',
      tagline: 'Beyond fear, destiny awaits.',
      releaseDate: '2021-09-15',
      runtime: 155,
      genres: ['Science Fiction', 'Adventure'],
      studios: ['Legendary Pictures', 'Warner Bros. Pictures'],
      countries: ['Canada', 'United States of America'],
      rating: { value: 7.8, votes: 12000 },
      posterPath: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
      collection: { id: { provider: 'tmdb', id: 726871 }, name: 'Dune Collection' },
    });
    expect(movie?.directors).toEqual(['Denis Villeneuve']);
    // A person credited twice appears once; a novelist or a composer is no writer.
    expect(movie?.writers).toEqual(['Denis Villeneuve', 'Jon Spaihts', 'Eric Roth']);
    expect(movie?.collection).not.toHaveProperty('overview');
    // Keywords come as given by TMDB: blanks and repeats are dropped, nothing is translated.
    expect(movie?.tags).toEqual(['desert', 'based on novel or book']);
  });

  it('lists the released movies of a collection, with their year, in the language asked', async () => {
    const { provider, requests } = make([
      at('/3/collection/726871', () =>
        json(
          JSON.stringify({
            id: 726871,
            name: 'Dune - Saga',
            overview: '  Spice.  ',
            parts: [
              { id: 438631, title: 'Dune', release_date: '2021-09-15' },
              { id: 693134, title: 'Dune : Deuxième partie', release_date: '2024-02-27' },
              { id: 1, title: 'Not yet dated', release_date: '' },
              { id: 2, title: 'Announced', release_date: '2999-01-01' },
              { id: 3, title: 'Rumoured', release_date: null },
            ],
          }),
        ),
      ),
      at('/3/collection/404', () => json('{"success":false,"status_code":34}', 404)),
    ]);
    const collection = await provider.getCollection({ provider: 'tmdb', id: 726871 }, 'fr');
    expect(collection).toEqual({
      id: { provider: 'tmdb', id: 726871 },
      name: 'Dune - Saga',
      overview: 'Spice.',
      parts: [
        { id: { provider: 'tmdb', id: 438631 }, title: 'Dune', year: 2021 },
        { id: { provider: 'tmdb', id: 693134 }, title: 'Dune : Deuxième partie', year: 2024 },
      ],
    });
    expect(requests[0]?.url.searchParams.get('language')).toBe('fr');
    expect(await provider.getCollection({ provider: 'tmdb', id: 404 })).toBeNull();
  });

  it("rates a movie for the request's language, then for the United States", async () => {
    const { provider } = make(detailRoutes);

    expect((await provider.getMovieDetails(movieId, 'fr'))?.certification).toEqual({
      country: 'FR',
      value: '12',
    });
    // Germany is listed without a rating: the American one comes next.
    expect((await provider.getMovieDetails(movieId, 'de'))?.certification).toEqual({
      country: 'US',
      value: 'PG-13',
    });
  });

  it('keeps the 20 first cast members, in order, without empty fields', async () => {
    const { provider } = make(detailRoutes);
    const movie = await provider.getMovieDetails(movieId);

    expect(movie?.cast).toHaveLength(20);
    expect(movie?.cast[0]).toEqual({
      name: 'Actor 0',
      role: 'Role 0',
      order: 0,
      profilePath: '/p0.jpg',
    });
    expect(movie?.cast[1]).toEqual({ name: 'No Photo', order: 1 });
    expect(movie?.cast[19]?.name).toBe('Actor 19');
  });

  it('maps a series, dropping an empty imdb id and a rating nobody gave', async () => {
    const { provider } = make(detailRoutes);
    const series = await provider.getSeriesDetails(tvId);

    expect(series).toMatchObject({
      kind: 'series',
      title: 'The Bear',
      firstAirDate: '2022-06-23',
      status: 'Returning Series',
      genres: ['Drama', 'Comedy'],
      studios: ['FX Productions'],
      countries: [],
      posterPath: '/sHFlbKS3WLqMnp9t2ghADIJFnuQ.jpg',
      seasons: [
        { season: 0, name: 'Specials' },
        { season: 1, name: 'Season 1', posterPath: '/s1.jpg' },
      ],
    });
    expect(series).not.toHaveProperty('imdbId'); // `""` in the fixture
    expect(series).not.toHaveProperty('rating'); // vote_average 8.6 over 0 votes
    expect(series).not.toHaveProperty('tagline'); // `""`
    expect(series).not.toHaveProperty('backdropPath'); // null
    expect(series?.cast).toHaveLength(3);
    expect(series?.tags).toEqual(['chef', 'restaurant']);
  });

  it('rates a series from its content ratings', async () => {
    const { provider, requests } = make(detailRoutes);
    const series = await provider.getSeriesDetails(tvId, 'fr');

    expect(requests[0]?.url.searchParams.get('append_to_response')).toBe(
      'credits,external_ids,keywords,content_ratings,images',
    );
    expect(series?.certification).toEqual({ country: 'FR', value: '16' });
  });

  it('reads the imdb id of a series from external_ids', async () => {
    const body = JSON.parse(fixture('details-tv-136315.json')) as {
      external_ids: { imdb_id: string };
    };
    body.external_ids.imdb_id = 'tt14452776';
    const { provider } = make([
      at('/3/tv/136315', () => json(JSON.stringify(body))),
      ...detailRoutes,
    ]);
    expect((await provider.getSeriesDetails(tvId))?.imdbId).toBe('tt14452776');
  });

  it('reads the tvdb id of a series from external_ids', async () => {
    const body = JSON.parse(fixture('details-tv-136315.json')) as {
      external_ids: { tvdb_id: number | null };
    };
    const { provider } = make([
      at('/3/tv/136315', () => json(JSON.stringify(body))),
      ...detailRoutes,
    ]);
    expect((await provider.getSeriesDetails(tvId))?.tvdbId).toBe(403539);
    body.external_ids.tvdb_id = null;
    const { provider: none } = make([
      at('/3/tv/136315', () => json(JSON.stringify(body))),
      ...detailRoutes,
    ]);
    expect(await none.getSeriesDetails(tvId)).not.toHaveProperty('tvdbId');
  });

  it('ignores an empty imdb id on a movie', async () => {
    const body = { ...(fixtureJson('details-movie-438631.json') as object), imdb_id: '' };
    const { provider } = make([
      at('/3/movie/438631', () => json(JSON.stringify(body))),
      ...detailRoutes,
    ]);
    expect(await provider.getMovieDetails(movieId)).not.toHaveProperty('imdbId');
  });

  describe('logo', () => {
    const logo = (file: string, lang: string | null, votes = 0, width = 500) => ({
      file_path: `/${file}.png`,
      iso_639_1: lang,
      vote_average: votes,
      width,
    });
    const movieWith = async (logos: readonly object[], language?: string) => {
      const body = { ...(fixtureJson('details-movie-438631.json') as object), images: { logos } };
      const { provider } = make([
        at('/3/movie/438631/images', () => json('{"posters":[],"backdrops":[],"logos":[]}')),
        at('/3/movie/438631', () => json(JSON.stringify(body))),
      ]);
      return provider.getMovieDetails(movieId, language);
    };

    it('takes the one in the metadata language before English and textless ones', async () => {
      const logos = [logo('en', 'en', 9), logo('none', null, 9), logo('fr', 'fr', 1)];
      expect((await movieWith(logos, 'fr-FR'))?.logoPath).toBe('/fr.png');
      expect((await movieWith(logos, 'de'))?.logoPath).toBe('/en.png');
      expect((await movieWith([logo('none', null)], 'fr'))?.logoPath).toBe('/none.png');
    });

    it('takes the best voted of a language, then the widest', async () => {
      const logos = [logo('a', 'en', 3), logo('b', 'en', 5, 300), logo('c', 'en', 5, 900)];
      expect((await movieWith(logos, 'en'))?.logoPath).toBe('/c.png');
    });

    it('drops a file that is not a PNG or JPEG, and has none when TMDB lists none', async () => {
      const svg = { ...logo('x', 'en', 9), file_path: '/x.svg' };
      expect(await movieWith([svg, logo('png', 'en', 1)])).toMatchObject({ logoPath: '/png.png' });
      expect(await movieWith([svg])).not.toHaveProperty('logoPath');
      expect(await movieWith([])).not.toHaveProperty('logoPath');
    });

    describe('when none is in the languages asked for', () => {
      const withEverything = async (logos: readonly object[], elsewhere: readonly object[]) => {
        const body = {
          ...(fixtureJson('details-movie-438631.json') as object),
          images: { logos },
        };
        const { provider, requests } = make([
          at('/3/movie/438631/images', () =>
            json(
              JSON.stringify({
                posters: [],
                backdrops: [],
                logos: elsewhere.map((one) => ({ ...one, height: 200 })),
              }),
            ),
          ),
          at('/3/movie/438631', () => json(JSON.stringify(body))),
        ]);
        return { details: await provider.getMovieDetails(movieId, 'fr'), requests };
      };

      it('takes one in another language, textless first, so a Chinese-only work has a logo', async () => {
        const { details, requests } = await withEverything(
          [],
          [logo('zh', 'zh', 9), logo('ja', 'ja', 1), logo('none', null, 0)],
        );
        expect(details?.logoPath).toBe('/none.png');
        expect(requests.map((request) => request.url.pathname)).toEqual([
          '/3/movie/438631',
          '/3/movie/438631/images',
        ]);
        expect(
          (await withEverything([], [logo('zh', 'zh', 9), logo('ja', 'ja', 1)])).details?.logoPath,
        ).toBe('/zh.png');
      });

      it('asks nothing more when a logo was found, and none when no language has one', async () => {
        const found = await withEverything([logo('fr', 'fr', 1)], [logo('zh', 'zh', 9)]);
        expect(found.details?.logoPath).toBe('/fr.png');
        expect(found.requests).toHaveLength(1);
        expect((await withEverything([], [])).details).not.toHaveProperty('logoPath');
      });
    });

    it('reads the logo of a series too', async () => {
      const body = {
        ...(fixtureJson('details-tv-136315.json') as object),
        images: { logos: [logo('bear', 'en', 2)] },
      };
      const { provider } = make([
        at('/3/tv/136315', () => json(JSON.stringify(body))),
        ...detailRoutes,
      ]);
      expect((await provider.getSeriesDetails(tvId, 'en'))?.logoPath).toBe('/bear.png');
    });
  });

  it('returns null for an unknown work', async () => {
    const { provider } = make(detailRoutes);
    expect(await provider.getMovieDetails({ provider: 'tmdb', id: 404 })).toBeNull();
    expect(await provider.getSeriesDetails({ provider: 'tmdb', id: 404 })).toBeNull();
  });

  it('rejects an id from another provider', async () => {
    const { provider } = make(detailRoutes);
    expect(await codeOf(provider.getMovieDetails({ provider: 'tvdb', id: 1 }))).toBe(
      'provider.foreign-id',
    );
    expect(await codeOf(provider.getSeriesDetails({ provider: 'tvdb', id: 1 }))).toBe(
      'provider.foreign-id',
    );
  });
});

describe('image paths', () => {
  it('keeps only what reads as a TMDB image path', async () => {
    const result = (poster_path: string) => ({
      id: 1,
      title: 'X',
      original_title: 'X',
      release_date: '2001-01-01',
      poster_path,
    });
    const { provider } = make(
      [
        at('/3/search/movie', () =>
          json(
            JSON.stringify({
              results: [
                result('/kqjL17yufvn9OVLyXYpvtyrFfak.jpg'),
                result('/../../etc/passwd'),
                result('https://evil.example/x.jpg'),
              ],
            }),
          ),
        ),
      ],
      { alternativeTitlesFor: 0 },
    );
    const found = await provider.searchMovies({ title: 'X' });
    expect(found.map((candidate) => candidate.posterPath)).toEqual([
      '/kqjL17yufvn9OVLyXYpvtyrFfak.jpg',
      undefined,
      undefined,
    ]);
  });
});

describe('imageUrl', () => {
  it('picks the size from what the image is for', () => {
    const { provider } = make([]);
    expect(provider.imageUrl('/abc.jpg', 'preview')).toBe(
      'https://image.tmdb.org/t/p/w185/abc.jpg',
    );
    expect(provider.imageUrl('/abc.jpg', 'standard')).toBe(
      'https://image.tmdb.org/t/p/w780/abc.jpg',
    );
    expect(provider.imageUrl('/abc.jpg', 'original')).toBe(
      'https://image.tmdb.org/t/p/original/abc.jpg',
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

  it('reads Retry-After given as an HTTP date', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const now = Date.parse('2026-01-01T00:00:00Z');
    const { provider } = make(
      [
        at('/3/tv/136315/season/3', () => {
          calls += 1;
          return calls === 1
            ? new Response('', {
                status: 429,
                headers: { 'retry-after': new Date(now + 3000).toUTCString() },
              })
            : json('{"season_number":3,"episodes":[]}');
        }),
      ],
      {
        now: () => now,
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      },
    );
    await provider.getSeason({ provider: 'tmdb', id: 136315 }, 3);
    expect(sleeps).toEqual([3000]);
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

  it('retries a body cut on its way, as a network failure', async () => {
    let calls = 0;
    const cut = (): Response =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError('terminated'));
          },
        }),
        { status: 200 },
      );
    const { provider } = make([
      at('/3/search/movie', () => {
        calls += 1;
        return calls === 1 ? cut() : json('{"results":[]}');
      }),
    ]);
    expect(await provider.searchMovies({ title: 'x' })).toEqual([]);
    expect(calls).toBe(2);
  });

  it('keeps no answer it could not read: the next request asks again', async () => {
    let calls = 0;
    const { provider } = make(
      [
        at('/3/search/movie', () => {
          calls += 1;
          return calls === 1 ? new Response('<html>portal</html>') : json('{"results":[]}');
        }),
      ],
      { cache: new MemoryCache() },
    );
    expect(await codeOf(provider.searchMovies({ title: 'x' }))).toBe('tmdb.invalid-response');
    expect(await provider.searchMovies({ title: 'x' })).toEqual([]);
    expect(calls).toBe(2);
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

describe('requests shared between providers', () => {
  const slowSeason = () => {
    let calls = 0;
    let inFlight = 0;
    let peak = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return json('{"season_number":1,"episodes":[]}');
    };
    return { fetchImpl, calls: () => calls, peak: () => peak };
  };

  it('makes one request for the same thing asked at once', async () => {
    const slow = slowSeason();
    const provider = new TmdbProvider({ apiKey: BEARER, fetch: slow.fetchImpl, sleep: noSleep });
    const id = { provider: 'tmdb', id: 7 };
    await Promise.all([1, 2, 3].map(() => provider.getSeason(id, 1)));
    expect(slow.calls()).toBe(1);
  });

  it('shares the same request between providers of one pool', async () => {
    const slow = slowSeason();
    const pool = new RequestPool();
    const make1 = () =>
      new TmdbProvider({ apiKey: BEARER, fetch: slow.fetchImpl, sleep: noSleep, pool });
    await Promise.all([make1(), make1()].map((p) => p.getSeason({ provider: 'tmdb', id: 7 }, 1)));
    expect(slow.calls()).toBe(1);
  });

  it('applies one limit to the providers of a pool', async () => {
    const slow = slowSeason();
    const pool = new RequestPool(2);
    const providers = [1, 2, 3, 4].map(
      () => new TmdbProvider({ apiKey: BEARER, fetch: slow.fetchImpl, sleep: noSleep, pool }),
    );
    await Promise.all(providers.map((p, n) => p.getSeason({ provider: 'tmdb', id: n }, 1)));
    expect(slow.peak()).toBe(2);
  });
});

describe('listImages', () => {
  const images = JSON.stringify({
    id: 438631,
    posters: [
      {
        file_path: '/aaa.jpg',
        iso_639_1: 'fr',
        width: 2000,
        height: 3000,
        vote_average: 5.5,
        vote_count: 10,
      },
      {
        file_path: '/bbb.jpg',
        iso_639_1: null,
        width: 1000,
        height: 1500,
        vote_average: 0,
        vote_count: 0,
      },
    ],
    backdrops: [{ file_path: '/ccc.jpg', iso_639_1: null, width: 3840, height: 2160 }],
    logos: [
      {
        file_path: '/ddd.png',
        iso_639_1: 'en',
        width: 800,
        height: 300,
        vote_average: 5.2,
        vote_count: 2,
      },
      { file_path: '/eee.svg', iso_639_1: 'en', width: 800, height: 300 },
    ],
  });

  it('asks for every language and keeps what can be written', async () => {
    const { provider, requests } = make([at('/3/movie/438631/images', () => json(images))]);
    const result = await provider.listImages({ provider: 'tmdb', id: 438631 }, 'movie');

    expect(requests[0]?.url.searchParams.has('include_image_language')).toBe(false);
    expect(requests[0]?.url.searchParams.has('language')).toBe(false);
    expect(result?.poster).toEqual([
      {
        path: '/aaa.jpg',
        language: 'fr',
        width: 2000,
        height: 3000,
        rating: { value: 5.5, votes: 10 },
      },
      { path: '/bbb.jpg', width: 1000, height: 1500 },
    ]);
    expect(result?.fanart).toHaveLength(1);
    expect(result?.logo.map((logo) => logo.path)).toEqual(['/ddd.png']);
  });

  it('uses the tv endpoint for a series and answers null for an unknown work', async () => {
    const { provider, requests } = make([
      at('/3/tv/1/images', () => json('{"success":false}', 404)),
    ]);
    expect(await provider.listImages({ provider: 'tmdb', id: 1 }, 'series')).toBeNull();
    expect(requests[0]?.url.pathname).toBe('/3/tv/1/images');
  });
});
