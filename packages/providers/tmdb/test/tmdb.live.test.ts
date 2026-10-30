import { describe, expect, it } from 'vitest';
import { TmdbProvider } from '../src/index.js';

// Contract test against the real API, to confirm what fixtures cannot: auth scheme, response
// shapes, parameter names. Run with `pnpm test:live` (needs TMDB_API_KEY, see .env).
// Failure output must never contain the key: assertions only involve public data.
const live = process.env.KINOSHELF_LIVE === '1' && Boolean(process.env.TMDB_API_KEY);

describe.skipIf(!live)('TMDB (live)', () => {
  const provider = new TmdbProvider({ apiKey: process.env.TMDB_API_KEY ?? '', language: 'en-US' });

  it('finds Dune (2021) by title and year', async () => {
    const results = await provider.searchMovies({ title: 'Dune', year: 2021 });
    const dune = results.find((r) => r.id.id === 438631);
    expect(dune).toMatchObject({ kind: 'movie', title: 'Dune', year: 2021 });
    expect(Array.isArray(dune?.alternativeTitles)).toBe(true);
  });

  it('finds The Bear (2022) by title and year', async () => {
    const results = await provider.searchSeries({ title: 'The Bear', year: 2022 });
    expect(results.find((r) => r.id.id === 136315)).toMatchObject({ kind: 'series', year: 2022 });
  });

  it('reads a season, and reports a missing one as null', async () => {
    const id = { provider: 'tmdb', id: 136315 };
    const season = await provider.getSeason(id, 3);
    expect(season?.season).toBe(3);
    expect(season?.episodes.some((e) => e.episode === 4)).toBe(true);
    expect(await provider.getSeason(id, 99)).toBeNull();
  });

  it('reads full details, credits and imdb id included', async () => {
    const movie = await provider.getMovieDetails({ provider: 'tmdb', id: 438631 });
    expect(movie).toMatchObject({ kind: 'movie', title: 'Dune', imdbId: 'tt1160419' });
    expect(movie?.directors).toContain('Denis Villeneuve');
    expect(movie?.cast.length).toBeGreaterThan(0);
    const series = await provider.getSeriesDetails({ provider: 'tmdb', id: 136315 });
    expect(series?.seasons.length).toBeGreaterThan(0);
  });

  it('localizes titles when asked', async () => {
    const results = await provider.searchMovies({ title: 'Le Fabuleux Destin', language: 'fr' });
    expect(results.some((r) => r.originalTitle.includes('Amélie'))).toBe(true);
  });
});
