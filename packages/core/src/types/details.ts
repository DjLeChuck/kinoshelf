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

/** An age rating as a provider gives it: `16` in `FR`, `PG-13` in `US`. */
export interface Certification {
  readonly country: string;
  readonly value: string;
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
  /** The provider's keywords (`body horror`, `satire`), in its language, usually English. */
  readonly tags: readonly string[];
  readonly studios: readonly string[];
  /** Country names (not codes): what Kodi-format files carry. */
  readonly countries: readonly string[];
  readonly rating?: Rating;
  readonly certification?: Certification;
  /** Billing order. */
  readonly cast: readonly Person[];
  readonly posterPath?: string;
  readonly backdropPath?: string;
  /** The title art (a transparent PNG), in the metadata language when the provider has one. */
  readonly logoPath?: string;
}

export interface MovieDetails extends DetailsBase {
  readonly kind: 'movie';
  /** ISO date (`YYYY-MM-DD`). */
  readonly releaseDate?: string;
  /** Minutes. */
  readonly runtime?: number;
  readonly directors: readonly string[];
  readonly writers: readonly string[];
  /**
   * The collection the movie is filed under (`Kingsman Collection`): the provider's, unless the
   * owner overrode it (`withCollection`). It is what the NFO's `<set>` says.
   */
  readonly collection?: MovieCollection;
}

/**
 * A collection as a movie's metadata names it. `id` is the provider's: a collection the owner
 * made up (`Univers Marvel`) has none, and the NFO then carries the name alone.
 */
export interface MovieCollection {
  readonly id?: ExternalId;
  readonly name: string;
  readonly overview?: string;
}

/** A movie of a provider's collection. */
export interface CollectionPart {
  readonly id: ExternalId;
  readonly title: string;
  readonly year?: number;
}

/** A provider's collection with the movies it lists, so a library can tell how complete it is. */
export interface CollectionInfo {
  readonly id: ExternalId;
  readonly name: string;
  readonly overview?: string;
  readonly parts: readonly CollectionPart[];
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
  /** The series' TheTVDB id, when the provider knows it. */
  readonly tvdbId?: number;
  /** Every season the provider lists, specials (season 0) included. */
  readonly seasons: readonly SeasonSummary[];
}

export type Details = MovieDetails | SeriesDetails;

/** Which image a profile asks for, so the provider can pick a size that suits it. */
export type ImageSize = 'preview' | 'standard' | 'original';

/** The three images a work owns and a user may replace. */
export type WorkImageKind = 'poster' | 'fanart' | 'logo';

/** One image a provider offers for a work, as listed (nothing is downloaded). */
export interface ImageCandidate {
  /** The provider's path (`/abc.jpg`), what `MetadataProvider.imageUrl` turns into a URL. */
  readonly path: string;
  /** ISO 639-1; absent for an image with no text on it. */
  readonly language?: string;
  readonly width: number;
  readonly height: number;
  /** Absent when nobody voted. */
  readonly rating?: Rating;
}

/** Every image the provider offers for a work, by kind, in the provider's order. */
export type WorkImages = Readonly<Record<WorkImageKind, readonly ImageCandidate[]>>;
