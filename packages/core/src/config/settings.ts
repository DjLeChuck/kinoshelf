import { dirname, resolve } from 'node:path';
import { KinoshelfError } from '../errors.js';
import { loadProfile } from '../profiles/loader.js';
import type { TransferMode } from '../types/operation.js';
import type { DestinationRoots } from '../types/plan.js';
import type { Profile } from '../types/profile.js';
import type { Config } from './config.js';

/** Already-validated values that win over the config file (CLI flags, an API request). */
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
 * Merges overrides over the config file over defaults. A library organized in place
 * (destination = source) defaults to `move`, otherwise to `copy`.
 */
export async function resolveSettings(
  overrides: SettingsOverrides,
  config: Config,
  context: SettingsContext,
): Promise<Settings> {
  const sourceDir = resolve(context.sourceIsFile ? dirname(context.source) : context.source);

  const shared =
    overrides.dest ?? config.destination ?? (context.defaultToSource ? sourceDir : undefined);
  const movie = overrides.destMovies ?? config.destinationMovies ?? shared;
  const series = overrides.destSeries ?? config.destinationSeries ?? shared;
  if (movie === undefined || series === undefined) {
    throw new KinoshelfError('config.destination-required');
  }
  const roots = { movie: resolve(movie), series: resolve(series) };
  const destinations: DestinationRoots = roots.movie === roots.series ? roots.movie : roots;

  const inPlace = roots.movie === sourceDir && roots.series === sourceDir;
  const threshold = overrides.threshold ?? config.threshold;

  return {
    profile: await loadProfile(overrides.profile ?? config.profile ?? 'plex'),
    mode: overrides.mode ?? config.mode ?? (inPlace ? 'move' : 'copy'),
    ...(threshold !== undefined && { threshold }),
    metadataLanguage:
      overrides.metadataLanguage ?? config.metadataLanguage ?? context.defaultMetadataLanguage,
    destinations,
  };
}
