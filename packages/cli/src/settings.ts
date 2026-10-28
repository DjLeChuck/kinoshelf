import { dirname, resolve } from 'node:path';
import {
  loadBundledProfile,
  loadProfileFile,
  type DestinationRoots,
  type Profile,
  type TransferMode,
} from '@kinoshelf/core';
import type { Config } from './config.js';
import { CliError } from './errors.js';
import type { Locale } from './i18n/index.js';

export interface CommonOptions {
  readonly dest?: string;
  readonly destMovies?: string;
  readonly destSeries?: string;
  readonly profile?: string;
  readonly mode?: string;
  readonly threshold?: string;
  readonly metadataLanguage?: string;
}

export interface Settings {
  readonly profile: Profile;
  readonly mode: TransferMode;
  readonly threshold?: number;
  readonly metadataLanguage: string;
  readonly destinations: DestinationRoots;
}

const MODES: readonly TransferMode[] = ['copy', 'hardlink', 'move'];

function parseMode(value: string): TransferMode {
  const mode = MODES.find((m) => m === value);
  if (!mode) {
    throw new CliError('config.invalid-value', { value, option: '--mode' });
  }
  return mode;
}

function parseThreshold(value: string): number {
  const threshold = Number(value);
  if (value.trim() === '' || Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
    throw new CliError('config.invalid-value', { value, option: '--threshold' });
  }
  return threshold;
}

/** A path (contains a separator or ends in .yaml) or the id of a bundled profile. */
export function loadProfile(reference: string): Promise<Profile> {
  return /[\\/]|\.ya?ml$/i.test(reference)
    ? loadProfileFile(resolve(reference))
    : loadBundledProfile(reference);
}

/**
 * Merges flags over the config file over defaults. `source` is the scanned path: a library
 * organized in place (destination = source) defaults to `move`, otherwise to `copy`.
 * `defaultToSource` lets `scan` work on a folder without any destination.
 */
export async function resolveSettings(
  options: CommonOptions,
  config: Config,
  context: { source: string; sourceIsFile: boolean; defaultToSource: boolean; locale: Locale },
): Promise<Settings> {
  const sourceDir = resolve(context.sourceIsFile ? dirname(context.source) : context.source);

  const shared =
    options.dest ?? config.destination ?? (context.defaultToSource ? sourceDir : undefined);
  const movie = options.destMovies ?? config.destinationMovies ?? shared;
  const series = options.destSeries ?? config.destinationSeries ?? shared;
  if (movie === undefined || series === undefined) {
    throw new CliError('config.destination-required');
  }
  const roots = { movie: resolve(movie), series: resolve(series) };
  const destinations: DestinationRoots = roots.movie === roots.series ? roots.movie : roots;

  const inPlace = roots.movie === sourceDir && roots.series === sourceDir;
  const modeText = options.mode ?? config.mode;
  const threshold =
    options.threshold !== undefined ? parseThreshold(options.threshold) : config.threshold;

  return {
    profile: await loadProfile(options.profile ?? config.profile ?? 'plex'),
    mode: modeText === undefined ? (inPlace ? 'move' : 'copy') : parseMode(modeText),
    ...(threshold !== undefined && { threshold }),
    metadataLanguage:
      options.metadataLanguage ??
      config.metadataLanguage ??
      (context.locale === 'fr' ? 'fr' : 'en-US'),
    destinations,
  };
}
