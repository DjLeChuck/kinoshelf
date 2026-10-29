import {
  KinoshelfError,
  type ExternalId,
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
  movieSearchSchema,
  seasonSchema,
  tvAlternativeTitlesSchema,
  tvDetailSchema,
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
        episodes: response.episodes.map((episode) => ({
          season: episode.season_number,
          episode: episode.episode_number,
          ...(episode.name && { title: episode.name }),
          ...(episode.air_date && { airDate: episode.air_date }),
        })),
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
