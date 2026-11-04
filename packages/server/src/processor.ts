import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Database } from 'better-sqlite3';
import {
  metadataLanguageFor,
  libraryProfile,
  analyze,
  discoverVideos,
  GuessitParser,
  KinoshelfError,
  libraryOverrides,
  resolveSettings,
  type Config,
  type MetadataProvider,
} from '@kinoshelf/core';
import { RequestPool, SqliteHttpCache, tmdbFromEnv } from '@kinoshelf/provider-tmdb';
import type { Job, ProcessedJob } from './jobs.js';
import type { ProgressTracker } from './progress.js';

export interface ProcessorDeps {
  readonly config: Config;
  readonly configDir: string;
  readonly database: Database;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Replaces TMDB, for tests. */
  readonly createProvider?: (options: { language: string }) => MetadataProvider;
  /** Told where each analysis is; none for the CLI and the tests that do not look. */
  readonly progress?: ProgressTracker;
  /** Told of a folder a scan had to leave out because it could not be read. */
  readonly onUnreadable?: (path: string, error: unknown) => void;
}

/**
 * parse → match → plan for the path of a job. Read-only: executing the plan is a separate,
 * explicit step, so nothing touches the disk without having been validated.
 */
export function createProcessor(deps: ProcessorDeps): (job: Job) => Promise<ProcessedJob> {
  return async (job) => {
    deps.progress?.start(job.id);
    try {
      return await process(deps, job);
    } finally {
      deps.progress?.finish(job.id);
    }
  };
}

async function process(deps: ProcessorDeps, job: Job): Promise<ProcessedJob> {
  let isFile: boolean;
  try {
    isFile = (await stat(job.path)).isFile();
  } catch {
    throw new KinoshelfError('discover.not-found', { path: job.path });
  }

  // The library's own profile, mode, threshold and destinations over the global ones. A release
  // its watched folder submitted is read against the library's source: the in-place case
  // (source = destination) must not depend on which sub-folder arrived. A library removed since
  // the job was queued leaves the global settings.
  const library = deps.config.libraries?.find(({ id }) => id === job.libraryId);
  const settings = await resolveSettings(
    library ? libraryOverrides(library, deps.config.libraries ?? []) : {},
    deps.config,
    {
      source: library ? library.source : job.path,
      sourceIsFile: library ? false : isFile,
      defaultToSource: false,
      defaultMetadataLanguage: metadataLanguageFor(deps.config.locale),
    },
  );

  const progress = deps.progress;
  // A scan of a whole source holds releases side by side; a path sent by hand (or by the watcher)
  // is one release itself.
  const splitReleases = library !== undefined && resolve(job.path) === resolve(library.source);
  const files = await discoverVideos(
    job.path,
    undefined,
    (found) => {
      progress?.found(job.id, found);
    },
    {
      splitReleases,
      // A folder of the library read alone is parsed as it would be inside a scan of the source.
      ...(library && job.rescan && { parserRoot: library.source }),
      ...(deps.onUnreadable && { onUnreadable: deps.onUnreadable }),
    },
  );
  progress?.discovered(job.id, files.length);
  const analysis = await analyze(files, {
    parser: new GuessitParser(),
    provider: makeProvider(deps, settings.metadataLanguage),
    profile: settings.profile,
    destinationRoot: settings.destinations,
    mode: settings.mode,
    onParsing: (done, total) => {
      progress?.parsed(job.id, done, total);
    },
    onMatching: () => {
      progress?.identifying(job.id);
    },
    onProgress: (done, total, file) => {
      progress?.identified(job.id, done, total, file.displayPath);
    },
    onPlanning: () => {
      progress?.planning(job.id);
    },
    ...(settings.threshold !== undefined && { matching: { threshold: settings.threshold } }),
  });
  return {
    analysis,
    settings: {
      profile: libraryProfile(library, deps.config),
      mode: settings.mode,
      destinationRoot: settings.destinations,
    },
  };
}

/**
 * What every provider of a database shares: the cache (its table is created once) and the
 * request pool, so that a provider made per call neither multiplies the limit nor repeats a
 * request already in flight.
 */
const shared = new WeakMap<Database, { cache: SqliteHttpCache; pool: RequestPool }>();

export function makeProvider(deps: ProcessorDeps, language: string): MetadataProvider {
  if (deps.createProvider) {
    return deps.createProvider({ language });
  }
  let common = shared.get(deps.database);
  if (!common) {
    common = { cache: new SqliteHttpCache(deps.database), pool: new RequestPool() };
    shared.set(deps.database, common);
  }
  return tmdbFromEnv({
    env: deps.env,
    config: deps.config,
    configDir: deps.configDir,
    language,
    cache: common.cache,
    pool: common.pool,
  });
}
