import { describe, expect, it } from 'vitest';
import { KinoshelfError } from '@kinoshelf/core';
import {
  MemoryCache,
  TmdbProvider,
  tmdbApiKey,
  tmdbFromEnv,
  tmdbKeyFromEnv,
} from '../src/index.js';

describe('the TMDB key', () => {
  it('takes the variable over the saved key', () => {
    expect(tmdbApiKey({ TMDB_API_KEY: 'from-env' }, { apiKey: { tmdb: 'saved' } })).toBe(
      'from-env',
    );
  });

  it.each([[''], ['   '], [undefined]])(
    'falls back to the saved key when the variable is %j',
    (value) => {
      expect(tmdbKeyFromEnv({ TMDB_API_KEY: value })).toBeUndefined();
      expect(tmdbApiKey({ TMDB_API_KEY: value }, { apiKey: { tmdb: ' saved ' } })).toBe('saved');
    },
  );

  it('has none when neither sets one', () => {
    expect(tmdbApiKey({ TMDB_API_KEY: '' }, {})).toBeUndefined();
    expect(tmdbApiKey({}, { apiKey: { tmdb: '' } })).toBeUndefined();
  });
});

describe('tmdbFromEnv', () => {
  const options = { configDir: '/config', language: 'fr', cache: new MemoryCache() };

  it('makes a provider with whichever key applies', () => {
    expect(
      tmdbFromEnv({ ...options, env: { TMDB_API_KEY: '' }, config: { apiKey: { tmdb: 'k' } } }),
    ).toBeInstanceOf(TmdbProvider);
  });

  it('points images at KINOSHELF_TMDB_IMAGES_URL when set', () => {
    const provider = tmdbFromEnv({
      ...options,
      env: { TMDB_API_KEY: 'k', KINOSHELF_TMDB_IMAGES_URL: 'http://fake:9/t/p/' },
      config: {},
    });
    expect(provider.imageUrl('/a.jpg', 'preview')).toBe('http://fake:9/t/p/w185/a.jpg');
  });

  it('says where the key goes when there is none', () => {
    let thrown: unknown;
    try {
      tmdbFromEnv({ ...options, env: {}, config: {} });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KinoshelfError);
    expect((thrown as KinoshelfError).info).toEqual({
      code: 'config.tmdb-key-missing',
      params: { path: '/config/config.yaml' },
    });
  });
});
