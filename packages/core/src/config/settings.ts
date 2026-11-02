import { dirname, resolve } from 'node:path';
import { KinoshelfError } from '../errors.js';
import { loadProfile } from '../profiles/loader.js';
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
  readonly destMovies?: string;
  readonly destSeries?: string;
  readonly profile?: string;
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
export async function resolveSettings(
  overrides: SettingsOverrides,
  config: Config,
  context: SettingsContext,
): Promise<Settings> {
  const sourceDir = resolve(context.sourceIsFile ? dirname(context.source) : context.source);

  // Without a word of the caller, a kind goes to the first library of that type; the folder being
  // read stands in only as a last resort (a scan, which writes nothing).
  const firstOf = (type: 'movie' | 'series'): string | undefined =>
    config.libraries?.find((library) => library.type === type)?.source;
  const fallback = context.defaultToSource ? sourceDir : undefined;
  const movie = overrides.destMovies ?? overrides.dest ?? firstOf('movie') ?? fallback;
  const series = overrides.destSeries ?? overrides.dest ?? firstOf('series') ?? fallback;
  if (movie === undefined || series === undefined) {
    throw new KinoshelfError('config.destination-required');
  }
  const roots = { movie: resolve(movie), series: resolve(series) };
  const destinations: DestinationRoots = roots.movie === roots.series ? roots.movie : roots;

  const inPlace = roots.movie === sourceDir && roots.series === sourceDir;
  const threshold = overrides.threshold ?? config.threshold;

  return {
    profile: await loadProfile(libraryProfile(overrides, config)),
    mode: overrides.mode ?? config.mode ?? (inPlace ? 'move' : 'copy'),
    ...(threshold !== undefined && { threshold }),
    metadataLanguage:
      overrides.metadataLanguage ?? config.metadataLanguage ?? context.defaultMetadataLanguage,
    destinations,
  };
}
