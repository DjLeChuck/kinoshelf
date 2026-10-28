import {
  resolveSettings as resolveCoreSettings,
  type Config,
  type Settings,
  type TransferMode,
} from '@kinoshelf/core';
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

/**
 * Turns the flags into typed overrides, then lets the core merge them over the config file.
 * `defaultToSource` lets `scan` work on a folder without any destination.
 */
export function resolveSettings(
  options: CommonOptions,
  config: Config,
  context: { source: string; sourceIsFile: boolean; defaultToSource: boolean; locale: Locale },
): Promise<Settings> {
  return resolveCoreSettings(
    {
      ...(options.dest !== undefined && { dest: options.dest }),
      ...(options.destMovies !== undefined && { destMovies: options.destMovies }),
      ...(options.destSeries !== undefined && { destSeries: options.destSeries }),
      ...(options.profile !== undefined && { profile: options.profile }),
      ...(options.mode !== undefined && { mode: parseMode(options.mode) }),
      ...(options.threshold !== undefined && { threshold: parseThreshold(options.threshold) }),
      ...(options.metadataLanguage !== undefined && {
        metadataLanguage: options.metadataLanguage,
      }),
    },
    config,
    {
      source: context.source,
      sourceIsFile: context.sourceIsFile,
      defaultToSource: context.defaultToSource,
      defaultMetadataLanguage: context.locale === 'fr' ? 'fr' : 'en-US',
    },
  );
}
