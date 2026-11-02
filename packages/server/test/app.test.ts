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
  it('publishes the contract without credentials', async () => {
    const { app } = await harness();
    const response = await app.inject('/api/openapi.json');
    const spec = response.json<{
      openapi: string;
      info: { version: string };
      paths: Record<string, Record<string, { security?: unknown[] }>>;
    }>();
    expect(response.statusCode).toBe(200);
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.version).toBe('1.2.3');
    expect(Object.keys(spec.paths).sort()).toEqual([
      '/api/aliases',
      '/api/aliases/{id}',
      '/api/arrivals',
      '/api/batches/{id}',
      '/api/batches/{id}/undo',
      '/api/entries/{id}',
      '/api/entries/{id}/ignore',
      '/api/entries/{id}/match',
      '/api/entries/{id}/preview',
      '/api/events',
      '/api/executions/{id}',
      '/api/fs',
      '/api/history',
      '/api/images/{size}/{file}',
      '/api/jobs',
      '/api/jobs/{id}',
      '/api/jobs/{id}/entries',
      '/api/libraries',
      '/api/libraries/{id}',
      '/api/libraries/{id}/execute',
      '/api/libraries/{id}/items',
      '/api/libraries/{id}/items/{itemId}',
      '/api/libraries/{id}/scan',
      '/api/libraries/{id}/shows',
      '/api/libraries/{id}/shows/{tmdbId}',
      '/api/notifications/test',
      '/api/onboarding',
      '/api/plans/{id}/execute',
      '/api/search',
      '/api/session',
      '/api/settings',
      '/api/settings/api-key',
      '/api/settings/tmdb/test',
      '/api/setup/api-key',
      '/api/watch',
      '/api/watch/scan',
      '/api/work-destinations',
      '/api/work-destinations/{kind}/{tmdbId}',
      '/health',
    ]);
    expect(spec.paths['/health']?.get?.security).toEqual([]);
  });
});
