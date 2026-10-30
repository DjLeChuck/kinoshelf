import {
  KinoshelfError,
  type ExternalId,
  type ImageSize,
  type MovieDetails,
  type Person,
  type Rating,
  type SeriesDetails,
  type MetadataProvider,
  type MovieCandidate,
  type SearchQuery,
  type SeasonInfo,
  type SeriesCandidate,
} from '@kinoshelf/core';
import type { z } from 'zod';
import { TmdbClient, type TmdbClientOptions } from './client.js';
import {
  movieAlternativeTitlesSchema,
  movieDetailSchema,
  movieFullDetailsSchema,
  movieSearchSchema,
  seasonSchema,
  tvAlternativeTitlesSchema,
  tvDetailSchema,
  tvFullDetailsSchema,
  tvSearchSchema,
} from './schemas.js';

export interface TmdbProviderOptions extends TmdbClientOptions {
  /** Used when a query gives no language, e.g. `fr` or `en-US`. */
  readonly language?: string;
  /**
   * Alternative titles cost one request per candidate, so only the best-ranked results get
   * them (they are cached afterwards).
   */
  readonly alternativeTitlesFor?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SEARCH_TTL_MS = DAY_MS;
// New episodes appear in a season over time: keep this short so they are found.
const SEASON_TTL_MS = DAY_MS;
const ALTERNATIVE_TITLES_TTL_MS = 30 * DAY_MS;
const DETAIL_TTL_MS = DAY_MS;

const IMAGE_BASE = 'https://image.tmdb.org/t/p/';
// Sizes TMDB serves: w185 is enough for a list, w780 for a poster file.
const IMAGE_SIZES: Record<ImageSize, string> = {
  preview: 'w185',
  standard: 'w780',
  original: 'original',
};
// An NFO lists the main cast; TMDB sends hundreds of people for a long-running series.
const CAST_LIMIT = 20;
const WRITER_JOBS = new Set(['Screenplay', 'Writer', 'Story']);

/** TMDB reports 0 and 0 votes for a work nobody rated: that is no rating, not a zero. */
const ratingOf = (average?: number | null, votes?: number | null): Rating | undefined =>
  average != null && votes != null && votes > 0 ? { value: average, votes } : undefined;

const crewNames = (
  crew: readonly { name: string; job?: string | null | undefined }[] | null | undefined,
  jobs: ReadonlySet<string>,
): string[] => [
  ...new Set((crew ?? []).filter((c) => c.job != null && jobs.has(c.job)).map((c) => c.name)),
];

const yearOf = (date: string | null | undefined): number | undefined => {
  const year = date ? /^(\d{4})/.exec(date)?.[1] : undefined;
  return year === undefined ? undefined : Number(year);
};

/** Titles different from the ones already known, without duplicates. */
const extraTitles = (titles: readonly string[], known: readonly string[]): string[] => [
  ...new Set(titles.filter((title) => !known.includes(title))),
];

export class TmdbProvider implements MetadataProvider {
  readonly name = 'tmdb';
  private readonly client: TmdbClient;
  private readonly language: string | undefined;
  private readonly alternativeTitlesFor: number;

  constructor(options: TmdbProviderOptions) {
    this.client = new TmdbClient(options);
    this.language = options.language;
    this.alternativeTitlesFor = options.alternativeTitlesFor ?? 5;
  }

  async searchMovies(query: SearchQuery): Promise<readonly MovieCandidate[]> {
    const response = await this.client.get(
      '/3/search/movie',
      {
        query: query.title,
        year: query.year,
        language: query.language ?? this.language,
        include_adult: 'false',
      },
      movieSearchSchema,
      { ttlMs: SEARCH_TTL_MS },
    );

    return Promise.all(
      (response?.results ?? []).map((result, index) =>
        this.movieCandidate(result, index < this.alternativeTitlesFor),
      ),
    );
  }

  async getMovie(id: ExternalId, language?: string): Promise<MovieCandidate | null> {
    this.requireOwn(id);
    const response = await this.client.get(
      `/3/movie/${id.id}`,
      { language: language ?? this.language },
      movieDetailSchema,
      { ttlMs: DETAIL_TTL_MS, nullOn404: true },
    );
    return response && this.movieCandidate(response, true);
  }

  async getMovieDetails(id: ExternalId, language?: string): Promise<MovieDetails | null> {
    this.requireOwn(id);
    // One request for everything; the extra query string also keeps it apart from `getMovie`'s
    // cache entry.
    const r = await this.client.get(
      `/3/movie/${id.id}`,
      { language: language ?? this.language, append_to_response: 'credits,external_ids' },
      movieFullDetailsSchema,
      { ttlMs: DETAIL_TTL_MS, nullOn404: true },
    );
    if (!r) {
      return null;
    }
    const rating = ratingOf(r.vote_average, r.vote_count);
    return {
      kind: 'movie',
      id: { provider: this.name, id: r.id },
      title: r.title,
      originalTitle: r.original_title,
      ...this.commonDetails(r),
      ...(r.imdb_id && { imdbId: r.imdb_id }),
      ...(rating && { rating }),
      ...(r.release_date && { releaseDate: r.release_date }),
      ...(r.runtime != null && r.runtime > 0 && { runtime: r.runtime }),
      directors: crewNames(r.credits?.crew, new Set(['Director'])),
      writers: crewNames(r.credits?.crew, WRITER_JOBS),
      ...(r.belongs_to_collection && { collection: { name: r.belongs_to_collection.name } }),
    };
  }

  async getSeriesDetails(id: ExternalId, language?: string): Promise<SeriesDetails | null> {
    this.requireOwn(id);
    const r = await this.client.get(
      `/3/tv/${id.id}`,
      { language: language ?? this.language, append_to_response: 'credits,external_ids' },
      tvFullDetailsSchema,
      { ttlMs: DETAIL_TTL_MS, nullOn404: true },
    );
    if (!r) {
      return null;
    }
    const rating = ratingOf(r.vote_average, r.vote_count);
    const imdbId = r.external_ids?.imdb_id;
    return {
      kind: 'series',
      id: { provider: this.name, id: r.id },
      title: r.name,
      originalTitle: r.original_name,
      ...this.commonDetails(r),
      ...(imdbId && { imdbId }),
      ...(rating && { rating }),
      ...(r.first_air_date && { firstAirDate: r.first_air_date }),
      ...(r.status && { status: r.status }),
      seasons: (r.seasons ?? []).map((s) => ({
        season: s.season_number,
        ...(s.name && { name: s.name }),
        ...(s.poster_path && { posterPath: s.poster_path }),
      })),
    };
  }

  imageUrl(path: string, size: ImageSize): string {
    return `${IMAGE_BASE}${IMAGE_SIZES[size]}${path}`;
  }

  /** The fields movies and series share, whatever their TMDB spelling. */
  private commonDetails(r: {
    overview?: string | null | undefined;
    tagline?: string | null | undefined;
    poster_path?: string | null | undefined;
    backdrop_path?: string | null | undefined;
    genres?: readonly { name: string }[] | null | undefined;
    production_companies?: readonly { name: string }[] | null | undefined;
    production_countries?: readonly { name: string }[] | null | undefined;
    credits?:
      | {
          cast?:
            | readonly {
                name: string;
                character?: string | null | undefined;
                order?: number | null | undefined;
                profile_path?: string | null | undefined;
              }[]
            | null
            | undefined;
        }
      | null
      | undefined;
  }) {
    const cast: Person[] = (r.credits?.cast ?? []).slice(0, CAST_LIMIT).map((p) => ({
      name: p.name,
      ...(p.character && { role: p.character }),
      ...(p.order != null && { order: p.order }),
      ...(p.profile_path && { profilePath: p.profile_path }),
    }));
    return {
      genres: (r.genres ?? []).map((g) => g.name),
      studios: (r.production_companies ?? []).map((c) => c.name),
      countries: (r.production_countries ?? []).map((c) => c.name),
      cast,
      ...(r.overview && { overview: r.overview }),
      ...(r.tagline && { tagline: r.tagline }),
      ...(r.poster_path && { posterPath: r.poster_path }),
      ...(r.backdrop_path && { backdropPath: r.backdrop_path }),
    };
  }

  private async movieCandidate(
    result: z.infer<typeof movieDetailSchema>,
    withAlternatives: boolean,
  ): Promise<MovieCandidate> {
    const alternatives = withAlternatives
      ? await this.client.get(
          `/3/movie/${result.id}/alternative_titles`,
          {},
          movieAlternativeTitlesSchema,
          { ttlMs: ALTERNATIVE_TITLES_TTL_MS, nullOn404: true },
        )
      : null;
    const year = yearOf(result.release_date);
    return {
      kind: 'movie',
      id: { provider: this.name, id: result.id },
      title: result.title,
      originalTitle: result.original_title,
      alternativeTitles: extraTitles(alternatives?.titles.map((t) => t.title) ?? [], [
        result.title,
        result.original_title,
      ]),
      ...(year !== undefined && { year }),
      ...(result.overview && { overview: result.overview }),
      ...(result.poster_path && { posterPath: result.poster_path }),
      ...(result.popularity != null && { popularity: result.popularity }),
    };
  }

  async searchSeries(query: SearchQuery): Promise<readonly SeriesCandidate[]> {
    const response = await this.client.get(
      '/3/search/tv',
      {
        query: query.title,
        first_air_date_year: query.year,
        language: query.language ?? this.language,
        include_adult: 'false',
      },
      tvSearchSchema,
      { ttlMs: SEARCH_TTL_MS },
    );

    return Promise.all(
      (response?.results ?? []).map((result, index) =>
        this.seriesCandidate(result, index < this.alternativeTitlesFor),
      ),
    );
  }

  async getSeries(id: ExternalId, language?: string): Promise<SeriesCandidate | null> {
    this.requireOwn(id);
    const response = await this.client.get(
      `/3/tv/${id.id}`,
      { language: language ?? this.language },
      tvDetailSchema,
      { ttlMs: DETAIL_TTL_MS, nullOn404: true },
    );
    return response && this.seriesCandidate(response, true);
  }

  private async seriesCandidate(
    result: z.infer<typeof tvDetailSchema>,
    withAlternatives: boolean,
  ): Promise<SeriesCandidate> {
    const alternatives = withAlternatives
      ? await this.client.get(
          `/3/tv/${result.id}/alternative_titles`,
          {},
          tvAlternativeTitlesSchema,
          { ttlMs: ALTERNATIVE_TITLES_TTL_MS, nullOn404: true },
        )
      : null;
    const year = yearOf(result.first_air_date);
    return {
      kind: 'series',
      id: { provider: this.name, id: result.id },
      title: result.name,
      originalTitle: result.original_name,
      alternativeTitles: extraTitles(alternatives?.results.map((t) => t.title) ?? [], [
        result.name,
        result.original_name,
      ]),
      ...(year !== undefined && { year }),
      ...(result.overview && { overview: result.overview }),
      ...(result.poster_path && { posterPath: result.poster_path }),
      ...(result.popularity != null && { popularity: result.popularity }),
      ...(result.origin_country &&
        result.origin_country.length > 0 && { countries: result.origin_country }),
    };
  }

  async getSeason(
    seriesId: ExternalId,
    season: number,
    language?: string,
  ): Promise<SeasonInfo | null> {
    this.requireOwn(seriesId);

    const response = await this.client.get(
      `/3/tv/${seriesId.id}/season/${season}`,
      { language: language ?? this.language },
      seasonSchema,
      { ttlMs: SEASON_TTL_MS, nullOn404: true },
    );

    return (
      response && {
        season: response.season_number,
        episodes: response.episodes.map((episode) => {
          const directors = crewNames(episode.crew, new Set(['Director']));
          const writers = crewNames(episode.crew, WRITER_JOBS);
          const rating = ratingOf(episode.vote_average, episode.vote_count);
          return {
            season: episode.season_number,
            episode: episode.episode_number,
            ...(episode.name && { title: episode.name }),
            ...(episode.air_date && { airDate: episode.air_date }),
            ...(episode.overview && { overview: episode.overview }),
            ...(episode.runtime != null && episode.runtime > 0 && { runtime: episode.runtime }),
            ...(directors.length > 0 && { directors }),
            ...(writers.length > 0 && { writers }),
            ...(rating && { rating }),
            ...(episode.still_path && { stillPath: episode.still_path }),
          };
        }),
      }
    );
  }

  private requireOwn(id: ExternalId): void {
    if (id.provider !== this.name) {
      throw new KinoshelfError('provider.foreign-id', {
        expected: this.name,
        received: id.provider,
      });
    }
  }
}
