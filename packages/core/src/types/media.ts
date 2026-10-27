/** Metadata provider name, e.g. `tmdb`. */
export type ProviderName = string;

/** Identifier of a work at a provider. */
export interface ExternalId {
  readonly provider: ProviderName;
  readonly id: number;
}

/** What the parser believes it recognized. `unknown`: neither an episode nor a movie. */
export type ParsedKind = 'movie' | 'episode' | 'unknown';

/**
 * Result of parsing a file path, independent of the parser implementation.
 * Missing fields could not be deduced (neither from the file name nor from parent folders).
 */
export interface ParsedMedia {
  /** Path as given to the parser. */
  readonly path: string;
  readonly kind: ParsedKind;
  readonly title?: string;
  readonly year?: number;
  /** Season number (series). */
  readonly season?: number;
  /** Episode numbers; several values for a double episode. Empty for a movie. */
  readonly episodes: readonly number[];
  readonly episodeTitle?: string;
  /** Extension without the dot, lowercase (e.g. `mkv`). */
  readonly extension?: string;
  readonly releaseGroup?: string;
  readonly languages?: readonly string[];
}
