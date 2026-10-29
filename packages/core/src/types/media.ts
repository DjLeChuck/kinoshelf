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
  /**
   * For a movie named `Title - Subtitle (Year)`: the part after the dash. TMDB writes the whole
   * as one title (`Thor : Le Monde des ténèbres`), so the matcher compares both readings.
   */
  readonly subtitle?: string;
  /**
   * A title written in two languages with a dash and no spaces around it
   * (`Anatomy.Of.A.Fall-Anatomie.d.une.chute`): each half, as another reading of the title, since
   * TMDB knows the work under one language or the other, never under both at once.
   */
  readonly otherTitles?: readonly string[];
  readonly year?: number;
  /**
   * A movie of a numbered series (`Kill.Bill.Vol.2`): the number, which tells the volumes apart
   * when the rest of the title is the same.
   */
  readonly volume?: number;
  /** Season number (series). */
  readonly season?: number;
  /** Episode numbers; several values for a double episode. Empty for a movie. */
  readonly episodes: readonly number[];
  readonly episodeTitle?: string;
  /** Extension without the dot, lowercase (e.g. `mkv`). */
  readonly extension?: string;
  /**
   * Ids already present in the names (e.g. `{tmdb-438631}`, `[tmdbid-438631]`), typically
   * because the file was named by a previous run. A strong hint for the matcher.
   */
  readonly knownIds?: readonly ExternalId[];
  /**
   * Country named in the file name (`The.Office.US`), ISO 3166-1 alpha-2 (`UK` becomes `GB`).
   * Tells apart same-titled works made in different countries.
   */
  readonly country?: string;
  readonly releaseGroup?: string;
  readonly languages?: readonly string[];
}
