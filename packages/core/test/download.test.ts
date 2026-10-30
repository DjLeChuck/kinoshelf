import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchImage } from '../src/execution/download.js';

let server: Server;
let base = '';
let seenHeaders: Record<string, unknown> = {};

beforeAll(async () => {
  server = createServer((request, response) => {
    seenHeaders = request.headers;
    switch (request.url) {
      case '/ok':
        response.writeHead(200, { 'content-type': 'image/jpeg' }).end(Buffer.from([9, 8]));
        break;
      case '/redirect':
        response.writeHead(302, { location: '/ok' }).end();
        break;
      case '/missing':
        response.writeHead(404).end();
        break;
      case '/html':
        response.writeHead(200, { 'content-type': 'text/html' }).end('<p>no</p>');
        break;
      case '/huge-declared':
        response
          .writeHead(200, { 'content-type': 'image/png', 'content-length': 30 * 1024 * 1024 })
          .end();
        break;
      case '/huge-streamed': {
        response.writeHead(200, { 'content-type': 'image/png' });
        const chunk = Buffer.alloc(1024 * 1024);
        for (let i = 0; i < 25; i += 1) {
          response.write(chunk);
        }
        response.end();
        break;
      }
      default:
        response.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

const codeOf = async (path: string) =>
  fetchImage(base + path).then(
    () => 'ok',
    (error: unknown) => (error as { info?: { code: string } }).info?.code,
  );

describe('fetchImage', () => {
  it('returns the bytes, following a redirect, without credentials', async () => {
    expect([...(await fetchImage(`${base}/redirect`))]).toEqual([9, 8]);
    expect(seenHeaders['authorization']).toBeUndefined();
    expect(seenHeaders['cookie']).toBeUndefined();
  });

  it('refuses a non-2xx, a non-image and a body over 20 MB', async () => {
    expect(await codeOf('/missing')).toBe('execute.download-failed');
    expect(await codeOf('/html')).toBe('execute.download-not-image');
    expect(await codeOf('/huge-declared')).toBe('execute.download-too-large');
    expect(await codeOf('/huge-streamed')).toBe('execute.download-too-large');
  });

  it('reports an unreachable host as a failed download', async () => {
    const error = await fetchImage('http://127.0.0.1:1/x').catch((e: unknown) => e);
    expect(error).toMatchObject({ info: { code: 'execute.download-failed' } });
  });
});
