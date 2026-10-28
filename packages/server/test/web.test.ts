import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findWebRoot } from '../src/web.js';
import { cleanup, harness, makeDir, put } from './harness.js';

afterEach(cleanup);

async function withWeb() {
  const webRoot = await makeDir();
  await put(join(webRoot, 'index.html'), '<!doctype html><title>Kinoshelf</title>');
  await put(join(webRoot, 'assets', 'app-3f2a.js'), 'console.log(1)');
  await put(join(webRoot, 'favicon.svg'), '<svg/>');
  return { ...(await harness({ webRoot })), webRoot };
}

describe('the web UI', () => {
  it('serves the page at the root, uncached, and refuses to be framed', async () => {
    const { app } = await withWeb();
    const response = await app.inject('/');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.body).toContain('<title>Kinoshelf</title>');
  });

  it('serves hashed assets as immutable', async () => {
    const { app } = await withWeb();
    const response = await app.inject('/assets/app-3f2a.js');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('immutable');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('falls back to the page for a route of the UI, so a reload or a link works', async () => {
    const { app } = await withWeb();
    for (const url of ['/queue', '/history', '/settings/tmdb']) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('<title>Kinoshelf</title>');
    }
  });

  it('answers 404, not the page, for a missing file', async () => {
    const { app } = await withWeb();
    const response = await app.inject('/assets/missing.js');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: 'request.not-found' } });
  });

  it('keeps /api and /health out of the fallback', async () => {
    const { app, request } = await withWeb();
    const unknown = await request('GET', '/api/nope');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: { code: 'request.not-found' } });
    expect((await app.inject('/health')).json()).toMatchObject({ status: 'ok' });
    expect((await app.inject('/api/jobs')).statusCode).toBe(401);
  });

  it('only serves GET pages: a POST to a UI route is not the page', async () => {
    const { app } = await withWeb();
    expect((await app.inject({ method: 'POST', url: '/queue' })).statusCode).toBe(404);
  });

  it('leaves the API alone when there is no UI to serve', async () => {
    const { app } = await harness();
    expect((await app.inject('/')).statusCode).toBe(404);
    expect((await app.inject('/health')).statusCode).toBe(200);
  });
});

describe('findWebRoot', () => {
  it('takes KINOSHELF_WEB_DIR when it holds a page', async () => {
    const dir = await makeDir();
    await put(join(dir, 'index.html'), 'x');
    expect(findWebRoot({ KINOSHELF_WEB_DIR: dir })).toBe(dir);
  });

  it('ignores a folder without index.html', async () => {
    const dir = await makeDir();
    const found = findWebRoot({ KINOSHELF_WEB_DIR: dir });
    expect(found).not.toBe(dir);
  });
});
