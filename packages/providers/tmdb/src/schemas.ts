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
      origin_country: z.array(z.string()).nullish(),
      overview: z.string().nullish(),
      poster_path: z.string().nullish(),
      popularity: z.number().nullish(),
    }),
  ),
});

// The detail endpoints answer with one record shaped like a search result.
export const movieDetailSchema = movieSearchSchema.shape.results.element;
export const tvDetailSchema = tvSearchSchema.shape.results.element;

const crewMember = z.object({ name: z.string(), job: z.string().nullish() });

export const seasonSchema = z.object({
  season_number: z.number().int(),
  episodes: z.array(
    z.object({
      season_number: z.number().int(),
      episode_number: z.number().int(),
      name: z.string().nullish(),
      air_date: date,
      overview: z.string().nullish(),
      runtime: z.number().nullish(),
      still_path: z.string().nullish(),
      vote_average: z.number().nullish(),
      vote_count: z.number().nullish(),
      crew: z.array(crewMember).nullish(),
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

const named = z.object({ name: z.string() });

// What `append_to_response=credits,external_ids` adds; `cast` can hold hundreds of people.
const credits = z.object({
  cast: z
    .array(
      z.object({
        name: z.string(),
        character: z.string().nullish(),
        order: z.number().int().nullish(),
        profile_path: z.string().nullish(),
      }),
    )
    .nullish(),
  crew: z.array(crewMember).nullish(),
});

const detailsBase = {
  id: z.number().int(),
  overview: z.string().nullish(),
  tagline: z.string().nullish(),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
  vote_average: z.number().nullish(),
  vote_count: z.number().nullish(),
  genres: z.array(named).nullish(),
  production_companies: z.array(named).nullish(),
  production_countries: z.array(named).nullish(),
  credits: credits.nullish(),
};

export const movieFullDetailsSchema = z.object({
  ...detailsBase,
  title: z.string(),
  original_title: z.string(),
  release_date: date,
  runtime: z.number().nullish(),
  imdb_id: z.string().nullish(),
  belongs_to_collection: named.nullish(),
});

export const tvFullDetailsSchema = z.object({
  ...detailsBase,
  name: z.string(),
  original_name: z.string(),
  first_air_date: date,
  status: z.string().nullish(),
  external_ids: z.object({ imdb_id: z.string().nullish() }).nullish(),
  seasons: z
    .array(
      z.object({
        season_number: z.number().int(),
        name: z.string().nullish(),
        poster_path: z.string().nullish(),
      }),
    )
    .nullish(),
});
