import { afterEach, describe, expect, it } from 'vitest';
import { fakePlexTv } from './fake-plex-tv.js';
import { closeFakeServers, fakeServer } from './fake-server.js';
import { join } from 'node:path';
import { loadConfig } from '@kinoshelf/core';
import { cleanup, harness, librariesYaml, makeDir, put } from './harness.js';

afterEach(async () => {
  await cleanup();
  await closeFakeServers();
});

/** A real `config.yaml`, since signing in rewrites it (a typed token goes). */
async function appWith(env: Record<string, string>) {
  const configDir = await makeDir();
  await put(join(configDir, 'config.yaml'), librariesYaml(await makeDir()));
  return harness({ configDir, config: await loadConfig(configDir), env });
}

async function withPlexTv() {
  const tv = await fakePlexTv();
  const h = await appWith({ KINOSHELF_PLEX_TV_URL: tv.url });
  return { tv, h };
}

const body = (response: { body: string }): Record<string, unknown> =>
  JSON.parse(response.body) as Record<string, unknown>;

describe('signing in to Plex', () => {
  it('starts with a PIN, waits for the claim, then reports the account as signed in', async () => {
    const { tv, h } = await withPlexTv();
    expect(body(await h.request('GET', '/api/settings')).plexAccount).toBeNull();

    const started = await h.request('POST', '/api/plex/auth');
    expect(started.statusCode).toBe(200);
    const { id, url } = body(started) as { id: number; url: string };
    expect(url).toContain('/auth#?clientID=');
    expect(url).toContain('code=pin-code');

    expect(body(await h.request('GET', `/api/plex/auth/${String(id)}`))).toEqual({ done: false });
    expect(body(await h.request('GET', '/api/settings')).plexAccount).toBeNull();

    tv.claim();
    expect(body(await h.request('GET', `/api/plex/auth/${String(id)}`))).toEqual({ done: true });
    expect(body(await h.request('GET', '/api/settings')).plexAccount).toBe('signed-in');
  });

  it('refuses a PIN it did not make', async () => {
    const { h } = await withPlexTv();
    await h.request('POST', '/api/plex/auth');
    const response = await h.request('GET', '/api/plex/auth/12345');
    expect(response.statusCode).toBe(404);
    expect(body(response)).toEqual({ error: { code: 'plex.pin-unknown' } });
  });

  it('says plex.tv is unreachable with a 502', async () => {
    const h = await appWith({ KINOSHELF_PLEX_TV_URL: 'http://127.0.0.1:1' });
    const response = await h.request('POST', '/api/plex/auth');
    expect(response.statusCode).toBe(502);
    expect((body(response).error as { code: string }).code).toBe('plex.unreachable');
  });

  it('lists the servers of the account, local addresses first and relays last', async () => {
    const { tv, h } = await withPlexTv();
    expect((await h.request('GET', '/api/plex/servers')).statusCode).toBe(409);

    const { id } = body(await h.request('POST', '/api/plex/auth')) as { id: number };
    tv.claim();
    await h.request('GET', `/api/plex/auth/${String(id)}`);

    const { servers } = body(await h.request('GET', '/api/plex/servers')) as {
      servers: { name: string; connections: { uri: string }[] }[];
    };
    expect(servers.map((s) => s.name)).toEqual(['Salon']);
    expect(servers[0]?.connections.map((c) => c.uri)).toEqual([
      'http://192.168.1.10:32400',
      'https://relay.plex.direct:8443',
    ]);
  });

  it('replaces a token typed in the settings, and signing out forgets the sign-in', async () => {
    const { tv, h } = await withPlexTv();
    await h.request('PATCH', '/api/settings', {
      plex: { url: 'http://plex.local:32400', token: 'typed-by-hand' },
    });
    expect(body(await h.request('GET', '/api/settings')).plex).toMatchObject({
      tokenConfigured: true,
    });

    const { id } = body(await h.request('POST', '/api/plex/auth')) as { id: number };
    tv.claim();
    await h.request('GET', `/api/plex/auth/${String(id)}`);
    expect(body(await h.request('GET', '/api/settings')).plex).toMatchObject({
      tokenConfigured: false,
    });

    expect((await h.request('DELETE', '/api/plex/auth')).statusCode).toBe(204);
    expect(body(await h.request('GET', '/api/settings')).plexAccount).toBeNull();
  });

  it('is behind the key like the rest of the API', async () => {
    const { h } = await withPlexTv();
    const response = await h.app.inject({ method: 'POST', url: '/api/plex/auth' });
    expect(response.statusCode).toBe(401);
  });

  it('asks the media server with the signed-in token', async () => {
    const tv = await fakePlexTv();
    const pms = await fakeServer((r) =>
      r.url === '/library/sections'
        ? {
            body: '<MediaContainer><Directory key="1" type="movie"><Location path="/m"/></Directory></MediaContainer>',
          }
        : {},
    );
    const h = await appWith({ KINOSHELF_PLEX_TV_URL: tv.url });
    const { id } = body(await h.request('POST', '/api/plex/auth')) as { id: number };
    tv.claim();
    await h.request('GET', `/api/plex/auth/${String(id)}`);
    await h.request('PATCH', '/api/settings', { plex: { url: pms.url } });

    const test = await h.request('POST', '/api/notifications/test');
    expect(test.statusCode).toBe(200);
    const sent = pms.received.find((r) => r.url === '/library/sections')?.headers['x-plex-token'];
    expect(typeof sent).toBe('string');
    expect(tv.valid.has(String(sent))).toBe(true);
  });
});
