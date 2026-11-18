import { dirname, resolve } from 'node:path';
import { KinoshelfError } from '../errors.js';
import { buildProfile, type Metadata, type Naming } from '../profiles/build.js';
import type { TransferMode } from '../types/operation.js';
import type { DestinationRoots } from '../types/plan.js';
import type { Profile } from '../types/profile.js';
import type { Config } from './config.js';
import { libraryProfile } from './libraries.js';

/** Already-validated values that win over the config file (CLI flags, an API request). */
/** The language TMDB is asked in when nothing sets one: the interface's, as TMDB spells it. */
export const metadataLanguageFor = (locale: string | undefined): string =>
  locale === 'fr' ? 'fr' : 'en-US';

export interface SettingsOverrides {
  readonly dest?: string;
  /** `null`: no library for this kind, with no fallback on the first one of its type. */
  readonly destMovies?: string | null;
  readonly destSeries?: string | null;
  readonly naming?: Naming;
  readonly metadata?: Metadata;
  readonly mode?: TransferMode;
  readonly threshold?: number;
  readonly metadataLanguage?: string;
}

export interface Settings {
  readonly profile: Profile;
  readonly mode: TransferMode;
  readonly threshold?: number;
  readonly metadataLanguage: string;
  readonly destinations: DestinationRoots;
}

export interface SettingsContext {
  /** The path being processed. */
  readonly source: string;
  readonly sourceIsFile: boolean;
  /** Lets a read-only scan work on a folder without any destination. */
  readonly defaultToSource: boolean;
  /** Language of the TMDB titles when neither the overrides nor the config say. */
  readonly defaultMetadataLanguage: string;
}

/**
 * Merges overrides over the config file over defaults. Writing in the folder being read
 * (organized in place) defaults to `move`, otherwise to `copy`.
 */
export function resolveSettings(
  overrides: SettingsOverrides,
  config: Config,
  context: SettingsContext,
): Settings {
  const sourceDir = resolve(context.sourceIsFile ? dirname(context.source) : context.source);

  // Without a word of the caller, a kind goes to the first library of that type; the folder being
  // read stands in only as a last resort (a scan, which writes nothing).
  const firstOf = (type: 'movie' | 'series'): string | undefined =>
    config.libraries?.find((library) => library.type === type)?.source;
  const fallback = context.defaultToSource ? sourceDir : undefined;
  const rootOf = (
    given: string | null | undefined,
    type: 'movie' | 'series',
  ): string | undefined =>
    given === null ? undefined : (given ?? overrides.dest ?? firstOf(type) ?? fallback);
  const movie = rootOf(overrides.destMovies, 'movie');
  const series = rootOf(overrides.destSeries, 'series');
  // One kind may have no library (only movies, or only series): its files are held back by the
  // planner. Nothing at all is a configuration the caller must fix.
  if (movie === undefined && series === undefined) {
    throw new KinoshelfError('config.destination-required');
  }
  const roots = {
    ...(movie !== undefined && { movie: resolve(movie) }),
    ...(series !== undefined && { series: resolve(series) }),
  };
  const destinations: DestinationRoots =
    roots.movie !== undefined && roots.movie === roots.series ? roots.movie : roots;

  const inPlace = [roots.movie, roots.series].every(
    (root) => root === undefined || root === sourceDir,
  );
  const threshold = overrides.threshold ?? config.threshold;

  return {
    profile: buildProfile(libraryProfile(overrides, config)),
    mode: overrides.mode ?? config.mode ?? (inPlace ? 'move' : 'copy'),
    ...(threshold !== undefined && { threshold }),
    metadataLanguage:
      overrides.metadataLanguage ?? config.metadataLanguage ?? context.defaultMetadataLanguage,
    destinations,
  };
}
