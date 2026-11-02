import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Config, MetadataProvider, MovieCandidate } from '@kinoshelf/core';
import { buildApp, type AppOptions } from '../src/app.js';
import { generateApiKey, setApiKey } from '../src/auth.js';
import { migrated } from '../src/database.js';
import type { Prober } from '../src/probe.js';

const created: string[] = [];
const apps: FastifyInstance[] = [];

/** A fresh directory with a fixed name: the parser reads folder names too. */
export async function makeDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kinoshelf-server-'));
  created.push(root);
  const directory = join(root, 'dir');
  await mkdir(directory);
  return directory;
}

export async function put(path: string, content = 'x'): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}

/** Registers an app built by a test, so `cleanup` closes it. */
export function track(app: FastifyInstance): FastifyInstance {
  apps.push(app);
  return app;
}

export async function cleanup(): Promise<void> {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(created.splice(0).map((d) => rm(d, { recursive: true, force: true })));
}

const film = (id: number, title: string, year: number): MovieCandidate => ({
  kind: 'movie',
  id: { provider: 'tmdb', id },
  title,
  originalTitle: title,
  alternativeTitles: [],
  year,
});

const catalog = [film(438631, 'Dune', 2021), film(348, 'Alien', 1979)];

/** Knows two films, so a `Dune.2021` file matches and anything else is unrecognized. */
export const fakeProvider: MetadataProvider = {
  name: 'fake',
  searchMovies: ({ title }) =>
    Promise.resolve(catalog.filter((c) => title.toLowerCase().startsWith(c.title.toLowerCase()))),
  searchSeries: () => Promise.resolve([]),
  getSeason: () => Promise.resolve(null),
  getMovieDetails: ({ id }) => {
    const found = catalog.find((c) => c.id.id === id);
    return Promise.resolve(
      found
        ? {
            kind: 'movie',
            id: found.id,
            title: found.title,
            originalTitle: found.originalTitle,
            genres: [],
            studios: [],
            countries: [],
            cast: [],
            directors: [],
            writers: [],
          }
        : null,
    );
  },
  getSeriesDetails: () => Promise.resolve(null),
  imageUrl: (path, size) => `https://image.test/${size}${path}`,
};

/** Reads no file: a codec chosen by the name, so a test can tell what was probed. */
export const fakeProber: Prober = async (path) => {
  const info = await stat(path);
  return {
    video: path.includes('hevc') ? 'hevc' : 'h264',
    audio: 'aac 2.0',
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
