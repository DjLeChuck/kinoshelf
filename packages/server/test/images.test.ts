import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, harness } from './harness.js';

afterEach(cleanup);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

async function withImages(answer: () => Response, env: Record<string, string> = {}) {
  const configDir = await mkdtemp(join(tmpdir(), 'kinoshelf-images-'));
  const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(answer()));
  const h = await harness({ configDir, fetch: fetcher, env });
  return { ...h, configDir, fetcher, drop: () => rm(configDir, { recursive: true, force: true }) };
}

describe('GET /api/images', () => {
  it('fetches a poster from TMDB once, then serves it from the disk', async () => {
    const h = await withImages(() => new Response(PNG));
    const first = await h.request('GET', '/api/images/w154/abc123.jpg');
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toBe('image/jpeg');
    expect(first.headers['cache-control']).toContain('private');
    expect(first.rawPayload).toEqual(Buffer.from(PNG));
    expect(h.fetcher.mock.calls[0]?.[0]).toBe('https://image.tmdb.org/t/p/w154/abc123.jpg');

    const second = await h.request('GET', '/api/images/w154/abc123.jpg');
    expect(second.rawPayload).toEqual(Buffer.from(PNG));
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(await readdir(join(h.configDir, 'images', 'w154'))).toEqual(['abc123.jpg']);
    await h.drop();
  });

  it('can fetch from another host than TMDB, for tests or a proxy', async () => {
    const h = await withImages(() => new Response(PNG), {
      KINOSHELF_TMDB_IMAGES_URL: 'http://127.0.0.1:9/t/p/',
    });
    expect((await h.request('GET', '/api/images/w92/abc.jpg')).statusCode).toBe(200);
    expect(h.fetcher.mock.calls[0]?.[0]).toBe('http://127.0.0.1:9/t/p/w92/abc.jpg');
    await h.drop();
  });

  it('needs a session or a key, like the rest of the API', async () => {
    const h = await withImages(() => new Response(PNG));
    expect((await h.app.inject('/api/images/w154/abc123.jpg')).statusCode).toBe(401);
    expect(h.fetcher).not.toHaveBeenCalled();
    await h.drop();
  });

  it.each([
    '/api/images/w9999/abc.jpg',
    '/api/images/w154/..%2Fsecret.jpg',
    '/api/images/w154/a.gif',
  ])('never reaches TMDB or the disk for %s', async (url) => {
    const h = await withImages(() => new Response(PNG));
    expect([400, 404]).toContain((await h.request('GET', url)).statusCode);
    expect(h.fetcher).not.toHaveBeenCalled();
    await h.drop();
  });

  it('answers 404 for a poster TMDB does not have, and 502 when TMDB fails', async () => {
    const missing = await withImages(() => new Response('', { status: 404 }));
    const notFound = await missing.request('GET', '/api/images/w92/gone.jpg');
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toEqual({ error: { code: 'image.not-found' } });
    await missing.drop();

    const broken = await withImages(() => new Response('', { status: 500 }));
    const failed = await broken.request('GET', '/api/images/w92/gone.jpg');
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({ error: { code: 'image.unavailable' } });
    await broken.drop();
  });

  it('does not keep an empty or oversized answer', async () => {
    const empty = await withImages(() => new Response(new Uint8Array()));
    expect((await empty.request('GET', '/api/images/w92/a.jpg')).statusCode).toBe(502);
    await empty.drop();

    const huge = await withImages(() => new Response(new Uint8Array(2_000_001)));
    expect((await huge.request('GET', '/api/images/w92/a.jpg')).statusCode).toBe(502);
    await readdir(join(huge.configDir, 'images')).then(
      (found) => {
        expect(found).toEqual([]);
      },
      () => undefined,
    );
    await huge.drop();
  });
});
