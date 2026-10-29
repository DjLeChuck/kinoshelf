import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import {
  analyze,
  discoverVideos,
  GuessitParser,
  KinoshelfError,
  resolveSettings,
  type Config,
  type MetadataProvider,
} from '@kinoshelf/core';
import { SqliteHttpCache, TmdbProvider } from '@kinoshelf/provider-tmdb';
import type { Job, ProcessedJob } from './jobs.js';

export interface ProcessorDeps {
  readonly config: Config;
  readonly configDir: string;
  readonly database: Database;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Replaces TMDB, for tests. */
  readonly createProvider?: (options: { language: string }) => MetadataProvider;
}

/**
 * parse → match → plan for the path of a job. Read-only: executing the plan is a separate,
 * explicit step, so nothing touches the disk without having been validated.
 */
export function createProcessor(deps: ProcessorDeps): (job: Job) => Promise<ProcessedJob> {
  return async (job) => {
    let isFile: boolean;
    try {
      isFile = (await stat(job.path)).isFile();
    } catch {
      throw new KinoshelfError('discover.not-found', { path: job.path });
    }

    const settings = await resolveSettings({}, deps.config, {
      source: job.path,
      sourceIsFile: isFile,
      defaultToSource: false,
      defaultMetadataLanguage: deps.config.locale === 'fr' ? 'fr' : 'en-US',
    });

    const analysis = await analyze(await discoverVideos(job.path), {
      parser: new GuessitParser(),
      provider: makeProvider(deps, settings.metadataLanguage),
      profile: settings.profile,
      destinationRoot: settings.destinations,
      mode: settings.mode,
      ...(settings.threshold !== undefined && { matching: { threshold: settings.threshold } }),
    });
    return {
      analysis,
      settings: {
        profile: deps.config.profile ?? 'plex',
        mode: settings.mode,
        destinationRoot: settings.destinations,
      },
    };
  };
}

export function makeProvider(deps: ProcessorDeps, language: string): MetadataProvider {
  if (deps.createProvider) {
    return deps.createProvider({ language });
  }
  const apiKey = (deps.env.TMDB_API_KEY ?? deps.config.apiKey?.tmdb ?? '').trim();
  if (!apiKey) {
    throw new KinoshelfError('config.tmdb-key-missing', {
      path: join(deps.configDir, 'config.yaml'),
    });
  }
  const baseUrl = (deps.env.KINOSHELF_TMDB_URL ?? '').trim();
  return new TmdbProvider({
    apiKey,
    language,
    cache: new SqliteHttpCache(deps.database),
    ...(baseUrl !== '' && { baseUrl }),
  });
}
