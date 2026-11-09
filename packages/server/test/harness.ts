import { stat } from 'node:fs/promises';
import Database from 'better-sqlite3';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Config, MetadataProvider } from '@kinoshelf/core';
import {
  FakeProvider,
  cleanup as cleanupDirectories,
  makeDir,
  movie,
  put,
} from '@kinoshelf/core/testing';
import { buildApp, type AppOptions } from '../src/app.js';
import { generateApiKey, setApiKey } from '../src/auth.js';
import { migrated } from '../src/database.js';
import { EntryStore } from '../src/entries.js';
import { ExecutionStore, type Execution } from '../src/executions.js';
import { presentEntry } from '../src/routes.js';
import type { Prober } from '../src/probe.js';

const apps: FastifyInstance[] = [];

export { makeDir, put };

/** Registers an app built by a test, so `cleanup` closes it. */
export function track(app: FastifyInstance): FastifyInstance {
  apps.push(app);
  return app;
}

export async function cleanup(): Promise<void> {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await cleanupDirectories();
}

/** Knows two films, so a `Dune.2021` file matches and anything else is unrecognized. */
const base = new FakeProvider(
  [movie(438631, 'Dune', 2021), movie(348, 'Alien', 1979)],
  {},
  ({ title }, candidate) => title.toLowerCase().startsWith(candidate.title.toLowerCase()),
);

// A plain object, so a test can spread it and override one method.
export const fakeProvider: MetadataProvider = {
  name: base.name,
  searchMovies: (query) => base.searchMovies(query),
  searchSeries: (query) => base.searchSeries(query),
  getSeason: (id, season) => base.getSeason(id, season),
  getMovieDetails: (id) => base.getMovieDetails(id),
  getSeriesDetails: (id) => base.getSeriesDetails(id),
  listImages: (id) => base.listImages(id),
  listEpisodeImages: (id, season) => base.listEpisodeImages(id, season),
  imageUrl: (path, size) => base.imageUrl(path, size),
};

/** Reads no file: a codec chosen by the name, so a test can tell what was probed. */
export const fakeProber: Prober = async (path) => {
  const info = await stat(path);
  return {
    video: path.includes('hevc') ? 'hevc' : 'h264',
    audio: 'aac 2.0',
    hdr: path.includes('hdr') ? 'hdr10' : null,
    audioLanguages: ['eng', 'fre'],
    subtitleLanguages: ['fre'],
    size: info.size,
    mtime: Math.floor(info.mtimeMs),
  };
};

export interface Harness {
  readonly app: FastifyInstance;
  readonly database: Database.Database;
  readonly apiKey: string;
  readonly destination: string;
  /** An authenticated request. */
  readonly request: (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) => Promise<LightMyRequestResponse>;
}

/**
 * The two libraries organized in place that give every kind of work a destination. Both read the
 * same folder, which is all a test needs to find what was written in one place.
 */
export const librariesAt = (root: string) =>
  [
    { id: 'films', name: 'Films', source: root, type: 'movie' },
    { id: 'shows', name: 'Shows', source: root, type: 'series' },
  ] as const;

/** The same two libraries, as the text of a `config.yaml`. */
export const librariesYaml = (root: string): string =>
  `libraries:\n  - {id: films, name: Films, source: ${root}, type: movie}\n` +
  `  - {id: shows, name: Shows, source: ${root}, type: series}\n`;

/** `realProvider` skips the fake TMDB, to exercise the key lookup. */
export async function harness(
  overrides: Partial<AppOptions> & { config?: Config; realProvider?: boolean } = {},
): Promise<Harness> {
  const { realProvider = false, ...options } = overrides;
  const database = migrated(new Database(':memory:'));
  const apiKey = generateApiKey();
  setApiKey(database, apiKey);
  const destination = await makeDir();
  const app = await buildApp({
    version: '1.2.3',
    config: { libraries: [...librariesAt(destination)] },
    configDir: '/nonexistent',
    database,
    env: {},
    ...(!realProvider && { createProvider: () => fakeProvider }),
    // Nothing in a test is a real video: the real `ffprobe` has its own test.
    prober: fakeProber,
    // Nothing is probed for a size either, unless a test gives the sizes it wants.
    sizeReader: () => Promise.resolve(undefined),
    ...options,
  });
  apps.push(app);
  return {
    app,
    database,
    apiKey,
    destination,
    request: (method, url, payload) =>
      app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${apiKey}` },
        ...(payload && { payload }),
      }),
  };
}

/**
 * The files of a job, shaped as `match` answers one. No route lists them (the web reads the
 * arrivals and the libraries); tests read the store to see what an analysis decided.
 */
export function jobEntries<T>(h: Pick<Harness, 'database'>, jobId: string): T[] {
  return new EntryStore(h.database)
    .list(jobId)
    .map((entry) => JSON.parse(JSON.stringify(presentEntry(entry))) as T);
}

/** A queued transfer and how it went, read from the store (the web follows the history instead). */
export function executionOf(h: Pick<Harness, 'database'>, id: string): Execution {
  const execution = new ExecutionStore(h.database).get(id);
  if (!execution) {
    throw new Error(`no execution ${id}`);
  }
  return execution;
}

/** The batch a finished transfer made. */
export function batchOf(h: Pick<Harness, 'database'>, executionId: string): string {
  const { batchId } = executionOf(h, executionId);
  if (batchId === null) {
    throw new Error(`execution ${executionId} made no batch`);
  }
  return batchId;
}
