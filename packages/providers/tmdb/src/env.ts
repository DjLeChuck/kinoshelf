import { join } from 'node:path';
import { KinoshelfError, type Config } from '@kinoshelf/core';
import type { HttpCache } from './cache.js';
import { TmdbProvider } from './tmdb-provider.js';

type Env = Readonly<Record<string, string | undefined>>;

/** `TMDB_API_KEY` when it holds a key: a variable set to blank (`TMDB_API_KEY=`) counts as unset. */
export function tmdbKeyFromEnv(env: Env): string | undefined {
  const key = env.TMDB_API_KEY?.trim();
  return key === undefined || key === '' ? undefined : key;
}

/** The TMDB key to use: the variable's, which wins, else the one `config.yaml` holds. */
export function tmdbApiKey(env: Env, config: Pick<Config, 'apiKey'>): string | undefined {
  const saved = config.apiKey?.tmdb?.trim();
  return tmdbKeyFromEnv(env) ?? (saved === undefined || saved === '' ? undefined : saved);
}

/**
 * The TMDB provider the CLI and the server use, with the key, the API address
 * (`KINOSHELF_TMDB_URL`, a fake TMDB in the end-to-end tests) and the images' address
 * (`KINOSHELF_TMDB_IMAGES_URL`) they are given. Without a key it
 * throws `config.tmdb-key-missing`, naming the file where one goes.
 */
export function tmdbFromEnv(options: {
  readonly env: Env;
  readonly config: Pick<Config, 'apiKey'>;
  readonly configDir: string;
  readonly language: string;
  readonly cache: HttpCache;
}): TmdbProvider {
  const apiKey = tmdbApiKey(options.env, options.config);
  if (apiKey === undefined) {
    throw new KinoshelfError('config.tmdb-key-missing', {
      path: join(options.configDir, 'config.yaml'),
    });
  }
  const baseUrl = options.env.KINOSHELF_TMDB_URL?.trim() ?? '';
  // The images NFO and artwork point at come from the same place the server's proxy reads.
  const imagesUrl = options.env.KINOSHELF_TMDB_IMAGES_URL?.trim() ?? '';
  return new TmdbProvider({
    apiKey,
    language: options.language,
    cache: options.cache,
    ...(baseUrl !== '' && { baseUrl }),
    ...(imagesUrl !== '' && { imagesUrl }),
  });
}
