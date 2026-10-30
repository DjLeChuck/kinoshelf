import type { ImageSize } from './details.js';

/**
 * Output profile, loaded from a YAML file. The core embeds no player-specific rule:
 * everything lives here.
 *
 * Template syntax: `{title}`, `{year}`, `{tmdb}`, `{season:02}`, `{episode:02}`…
 * `\{` and `\}` produce a literal brace (e.g. `\{tmdb-{tmdb}\}` → `{tmdb-438631}`).
 */
export interface Profile {
  readonly id: string;
  readonly name: string;
  /** Joins first and last episode of a multi-episode file, e.g. `-e` gives `s02e18-e19`. */
  readonly episodeRangeSeparator: string;
  readonly templates: PathTemplates;
  /** `null`: the profile writes no NFO. */
  readonly nfo: NfoSpec | null;
  /** Empty: the profile writes no images. */
  readonly artwork: readonly ArtworkSpec[];
  readonly filesystem: FilesystemRules;
}

/** Paths are relative to the destination root; `/` separates segments. */
export interface PathTemplates {
  /** Empty string: movies are written flat, directly in the destination root. */
  readonly movieFolder: string;
  /** File name without extension (added by the planner). */
  readonly movieFile: string;
  readonly seriesFolder: string;
  readonly seasonFolder: string;
  /** File name without extension. */
  readonly episodeFile: string;
}

export interface NfoSpec {
  readonly format: 'kodi';
  /** File names; `{file}` stands for the video file name without extension. */
  readonly movie: string;
  readonly episode: string;
  readonly series?: string;
}

export type ArtworkKind = 'poster' | 'fanart' | 'season-poster';

export interface ArtworkSpec {
  readonly kind: ArtworkKind;
  /** File name; a season poster may use `{season}`. */
  readonly name: string;
  /** What the provider serves: a backdrop is worth its full size, a poster rarely is. */
  readonly size: ImageSize;
}

export interface FilesystemRules {
  /** Set of forbidden characters to replace. */
  readonly forbidden: 'windows' | 'posix';
  /** Replacement for forbidden characters; empty string removes them. */
  readonly replacement: string;
  /** Maximum length of a path segment, in bytes. */
  readonly maxSegmentBytes: number;
}
