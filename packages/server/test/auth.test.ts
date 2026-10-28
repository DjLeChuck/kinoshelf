import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { generateApiKey, hasApiKey, isValidApiKey, setApiKey } from '../src/auth.js';
import { migrated } from '../src/database.js';
import { cleanup, harness } from './harness.js';

afterEach(cleanup);

describe('API key', () => {
  it('is stored only as a hash, and a new key replaces the old one', () => {
    const database = migrated(new Database(':memory:'));
    expect(hasApiKey(database)).toBe(false);

    const first = generateApiKey();
    setApiKey(database, first);
    expect(first).toMatch(/^ks_/);
    expect(JSON.stringify(database.prepare('SELECT * FROM api_keys').all())).not.toContain(first);
    expect(isValidApiKey(database, first)).toBe(true);
    expect(isValidApiKey(database, 'ks_wrong')).toBe(false);

    const second = generateApiKey();
    setApiKey(database, second);
    expect(isValidApiKey(database, first)).toBe(false);
    expect(isValidApiKey(database, second)).toBe(true);
  });

  it.each([
    ['no header', undefined],
    ['a wrong key', 'Bearer ks_wrong'],
    ['another scheme', 'Basic abc'],
  ])('is required on /api routes: %s', async (_name, authorization) => {
    const { app } = await harness();
    const response = await app.inject({
      method: 'GET',
      url: '/api/jobs',
      ...(authorization && { headers: { authorization } }),
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.json()).toEqual({ error: { code: 'auth.unauthorized' } });
  });

  it('lets a valid key through', async () => {
    const { request } = await harness();
    expect((await request('GET', '/api/jobs')).statusCode).toBe(200);
  });

  it('answers 503 while no key exists, then works as soon as one is created', async () => {
    const { app, database, request } = await harness();
    database.prepare('DELETE FROM api_keys').run();
    const response = await request('GET', '/api/jobs');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: 'auth.not-configured' } });
    expect((await app.inject('/health')).statusCode).toBe(200);

    const key = generateApiKey();
    setApiKey(database, key);
    const retry = await app.inject({
      method: 'GET',
      url: '/api/jobs',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(retry.statusCode).toBe(200);
  });
});
