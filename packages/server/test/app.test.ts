import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, harness } from './harness.js';

afterEach(cleanup);

describe('GET /health', () => {
  it('reports the service state without credentials', async () => {
    const { app } = await harness();
    const response = await app.inject('/health');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: '1.2.3' });
  });
});

describe('GET /api/openapi.json', () => {
  it('keeps the contract behind the key', async () => {
    const { app } = await harness();
    expect((await app.inject('/api/openapi.json')).statusCode).toBe(401);
  });

  it('publishes the contract to a client holding the key', async () => {
    const { request } = await harness();
    const response = await request('GET', '/api/openapi.json');
    const spec = response.json<{
      openapi: string;
      info: { version: string };
      paths: Record<string, Record<string, { security?: unknown[] }>>;
    }>();
    expect(response.statusCode).toBe(200);
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.version).toBe('1.2.3');
    expect(Object.keys(spec.paths).sort()).toEqual([
      '/api/arrivals',
      '/api/batches/{id}',
      '/api/batches/{id}/undo',
      '/api/entries/{id}',
      '/api/entries/{id}/ignore',
      '/api/entries/{id}/match',
      '/api/entries/{id}/preview',
      '/api/events',
      '/api/fs',
      '/api/health',
      '/api/health/report',
      '/api/history',
      '/api/images/{size}/{file}',
      '/api/jobs',
      '/api/jobs/{id}',
      '/api/libraries',
      '/api/libraries/{id}',
      '/api/libraries/{id}/collection',
      '/api/libraries/{id}/execute',
      '/api/libraries/{id}/items',
      '/api/libraries/{id}/items/{itemId}',
      '/api/libraries/{id}/items/{itemId}/images',
      '/api/libraries/{id}/items/{itemId}/images/preview',
      '/api/libraries/{id}/items/{itemId}/images/{type}/file',
      '/api/libraries/{id}/rescan',
      '/api/libraries/{id}/scan',
      '/api/libraries/{id}/shows',
      '/api/libraries/{id}/shows/{tmdbId}',
      '/api/libraries/{id}/shows/{tmdbId}/images',
      '/api/libraries/{id}/shows/{tmdbId}/images/preview',
      '/api/libraries/{id}/shows/{tmdbId}/images/{type}/file',
      '/api/libraries/{id}/shows/{tmdbId}/seasons/{season}/episodes/{episode}/images',
      '/api/libraries/{id}/shows/{tmdbId}/seasons/{season}/episodes/{episode}/images/preview',
      '/api/libraries/{id}/shows/{tmdbId}/seasons/{season}/episodes/{episode}/images/{type}/file',
      '/api/logs',
      '/api/logs/download',
      '/api/logs/level',
      '/api/notifications/test',
      '/api/onboarding',
      '/api/plans/{id}/execute',
      '/api/plex/auth',
      '/api/plex/auth/{id}',
      '/api/plex/servers',
      '/api/search',
      '/api/session',
      '/api/settings',
      '/api/settings/api-key',
      '/api/settings/tmdb/test',
      '/api/setup/api-key',
      '/api/tmdb/cache',
      '/api/tmdb/usage',
      '/api/watch',
      '/api/watch/scan',
      '/health',
    ]);
    expect(spec.paths['/health']?.get?.security).toEqual([]);
  });
});
