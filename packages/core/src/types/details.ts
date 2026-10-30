import type { ExternalId } from './media.js';

/**
 * Everything a metadata file (NFO) or an image download needs about a work, independent of the
 * provider and of the output format. Paths are the provider's own (`/abc.jpg`): turn one into a
 * URL with `MetadataProvider.imageUrl`, which keeps the planner off the network.
 */

export interface Person {
  readonly name: string;
  /** Character played (cast); absent for a crew member. */
  readonly role?: string;
  /** Billing order, 0 first. */
  readonly order?: number;
  readonly profilePath?: string;
}

/** A vote average on a 0 to 10 scale. */
export interface Rating {
  readonly value: number;
  readonly votes: number;
}

interface DetailsBase {
  readonly id: ExternalId;
  /** `tt…`, when the provider knows it. */
  readonly imdbId?: string;
  /** Localized title. */
  readonly title: string;
  readonly originalTitle: string;
  readonly tagline?: string;
  readonly overview?: string;
  readonly genres: readonly string[];
  readonly studios: readonly string[];
  /** Country names (not codes): what Kodi-format files carry. */
  readonly countries: readonly string[];
  readonly rating?: Rating;
  /** Billing order. */
  readonly cast: readonly Person[];
  readonly posterPath?: string;
  readonly backdropPath?: string;
}

export interface MovieDetails extends DetailsBase {
  readonly kind: 'movie';
  /** ISO date (`YYYY-MM-DD`). */
  readonly releaseDate?: string;
  /** Minutes. */
  readonly runtime?: number;
  readonly directors: readonly string[];
  readonly writers: readonly string[];
  /** The collection the movie belongs to (`Kingsman Collection`). */
  readonly collection?: { readonly name: string; readonly overview?: string };
}

export interface SeasonSummary {
  readonly season: number;
  readonly name?: string;
  readonly posterPath?: string;
}

export interface SeriesDetails extends DetailsBase {
  readonly kind: 'series';
  /** ISO date of the first episode. */
  readonly firstAirDate?: string;
  /** The provider's wording (`Returning Series`, `Ended`). */
  readonly status?: string;
  /** Every season the provider lists, specials (season 0) included. */
  readonly seasons: readonly SeasonSummary[];
}

export type Details = MovieDetails | SeriesDetails;

/** Which image a profile asks for, so the provider can pick a size that suits it. */
export type ImageSize = 'preview' | 'standard' | 'original';
