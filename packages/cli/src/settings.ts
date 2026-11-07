import {
  metadataLanguageFor,
  libraryOverrides,
  resolveSettings as resolveCoreSettings,
  METADATAS,
  NAMINGS,
  type Config,
  type Metadata,
  type Naming,
  type Settings,
  type TransferMode,
} from '@kinoshelf/core';
import { CliError } from './errors.js';
import type { Locale } from '@kinoshelf/i18n';

export interface CommonOptions {
  readonly library?: string;
  readonly dest?: string;
  readonly destMovies?: string;
  readonly destSeries?: string;
  readonly naming?: string;
  readonly metadata?: string;
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

function parseNaming(value: string): Naming {
  const naming = NAMINGS.find((n) => n === value);
  if (!naming) {
    throw new CliError('config.invalid-value', { value, option: '--naming' });
  }
  return naming;
}

function parseMetadata(value: string): Metadata {
  const metadata = METADATAS.find((m) => m === value);
  if (!metadata) {
    throw new CliError('config.invalid-value', { value, option: '--metadata' });
  }
  return metadata;
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
 * `--library` stands for the settings of a library of `config.yaml` (its destinations, naming,
 * metadata, mode, threshold); a flag given as well wins over it. `defaultToSource` lets `scan` work on a
 * folder without any destination.
 */
export function resolveSettings(
  options: CommonOptions,
  config: Config,
  context: { source: string; sourceIsFile: boolean; defaultToSource: boolean; locale: Locale },
): Settings {
  const libraries = config.libraries ?? [];
  const library =
    options.library === undefined ? undefined : libraries.find(({ id }) => id === options.library);
  if (options.library !== undefined && !library) {
    throw new CliError('config.library-unknown', {
      id: options.library,
      ids: libraries.map(({ id }) => id).join(', ') || '-',
    });
  }
  return resolveCoreSettings(
    {
      ...(library && libraryOverrides(library, libraries)),
      ...(options.dest !== undefined && { dest: options.dest }),
      ...(options.destMovies !== undefined && { destMovies: options.destMovies }),
      ...(options.destSeries !== undefined && { destSeries: options.destSeries }),
      ...(options.naming !== undefined && { naming: parseNaming(options.naming) }),
      ...(options.metadata !== undefined && { metadata: parseMetadata(options.metadata) }),
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
      defaultMetadataLanguage: metadataLanguageFor(context.locale),
    },
  );
}
