import { z } from 'zod';

// Only the fields Kinoshelf reads; TMDB adds more and they are ignored.
const date = z.string().nullish();

export const movieSearchSchema = z.object({
  results: z.array(
    z.object({
      id: z.number().int(),
      title: z.string(),
      original_title: z.string(),
      release_date: date,
      overview: z.string().nullish(),
      poster_path: z.string().nullish(),
      popularity: z.number().nullish(),
    }),
  ),
});

export const tvSearchSchema = z.object({
  results: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      original_name: z.string(),
      first_air_date: date,
      overview: z.string().nullish(),
      poster_path: z.string().nullish(),
      popularity: z.number().nullish(),
    }),
  ),
});

export const seasonSchema = z.object({
  season_number: z.number().int(),
  episodes: z.array(
    z.object({
      season_number: z.number().int(),
      episode_number: z.number().int(),
      name: z.string().nullish(),
      air_date: date,
    }),
  ),
});

// The movie endpoint answers with `titles`, the TV one with `results`.
export const movieAlternativeTitlesSchema = z.object({
  titles: z.array(z.object({ title: z.string() })),
});
export const tvAlternativeTitlesSchema = z.object({
  results: z.array(z.object({ title: z.string() })),
});
