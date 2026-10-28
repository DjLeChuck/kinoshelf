import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /health', () => {
  it('reports the service state without credentials', async () => {
    app = await buildApp({ version: '1.2.3' });
    const response = await app.inject('/health');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: '1.2.3' });
  });
});

describe('GET /api/openapi.json', () => {
  it('publishes the contract, including the health route', async () => {
    app = await buildApp({ version: '1.2.3' });
    const spec = (await app.inject('/api/openapi.json')).json<{
      openapi: string;
      info: { version: string };
      paths: Record<string, unknown>;
    }>();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.version).toBe('1.2.3');
    expect(spec.paths).toHaveProperty('/health');
    expect(spec.paths).not.toHaveProperty('/api/openapi.json');
  });
});
