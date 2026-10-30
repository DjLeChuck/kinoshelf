import type { ImageSize, Rating, MovieDetails, SeriesDetails } from './details.js';
import type { ExternalId } from './media.js';

export interface SearchQuery {
  readonly title: string;
  /** Absent for the second search, which ignores the year. */
  readonly year?: number;
  /** ISO 639-1 language code, e.g. `fr`. */
  readonly language?: string;
}

interface CandidateBase {
  readonly id: ExternalId;
  /** Localized title. */
  readonly title: string;
  readonly originalTitle: string;
  /** Alternative titles known to the provider; used by title similarity. */
  readonly alternativeTitles: readonly string[];
  readonly year?: number;
  readonly overview?: string;
  readonly posterPath?: string;
  readonly popularity?: number;
  /**
   * Countries of origin, ISO 3166-1 alpha-2, when the provider says so (TMDB does for series,
   * not in its movie search results). Absent means unknown, not "none".
   */
  readonly countries?: readonly string[];
}

export interface MovieCandidate extends CandidateBase {
  readonly kind: 'movie';
}

export interface SeriesCandidate extends CandidateBase {
  readonly kind: 'series';
}

export type Candidate = MovieCandidate | SeriesCandidate;

export interface EpisodeInfo {
  readonly season: number;
  readonly episode: number;
  readonly title?: string;
  /** ISO air date (`YYYY-MM-DD`). */
  readonly airDate?: string;
  /** The rest is what an episode NFO or thumbnail needs; the matcher never reads it. */
  readonly overview?: string;
  /** Minutes. */
  readonly runtime?: number;
  readonly directors?: readonly string[];
  readonly writers?: readonly string[];
  readonly rating?: Rating;
  readonly stillPath?: string;
}

/** Episodes of a season, in the provider's broadcast order. */
export interface SeasonInfo {
  readonly season: number;
  readonly episodes: readonly EpisodeInfo[];
}

/** Metadata source (TMDB in v0.1). No player-specific rule belongs here. */
export interface MetadataProvider {
  readonly name: string;
  searchMovies(query: SearchQuery): Promise<readonly MovieCandidate[]>;
  searchSeries(query: SearchQuery): Promise<readonly SeriesCandidate[]>;
  /**
   * `null` if the season does not exist at the provider (a normal matching outcome, not an
   * error; real failures such as network or rate limits throw). Season 0 (specials) is a
   * regular season. Checking that an episode exists in the returned season is the matcher's job.
   */
  getSeason(seriesId: ExternalId, season: number, language?: string): Promise<SeasonInfo | null>;
  /** Looks a work up by id; `null` if the provider does not know it (any other failure throws). */
  getMovie(id: ExternalId, language?: string): Promise<MovieCandidate | null>;
  getSeries(id: ExternalId, language?: string): Promise<SeriesCandidate | null>;
  /** Full record for a metadata file; `null` if unknown (any other failure throws). */
  getMovieDetails(id: ExternalId, language?: string): Promise<MovieDetails | null>;
  getSeriesDetails(id: ExternalId, language?: string): Promise<SeriesDetails | null>;
  /** URL of an image given its provider path. Pure: no request is made. */
  imageUrl(path: string, size: ImageSize): string;
}
