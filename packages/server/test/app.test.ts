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
      '/api/batches',
      '/api/batches/{id}',
      '/api/batches/{id}/undo',
      '/api/events',
      '/api/executions/{id}',
      '/api/jobs',
      '/api/jobs/{id}',
      '/api/jobs/{id}/entries',
      '/api/notifications/test',
      '/api/plans/{id}/execute',
      '/api/queue',
      '/api/queue/{id}/ignore',
      '/api/queue/{id}/match',
      '/api/search',
      '/api/session',
      '/health',
    ]);
    expect(spec.paths['/health']?.get?.security).toEqual([]);
  });
});
