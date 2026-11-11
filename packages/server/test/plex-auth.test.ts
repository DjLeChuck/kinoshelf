import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '@kinoshelf/core';
import { createPublicKey, verify } from 'node:crypto';
import { PlexClient } from '../src/notify/plex.js';
import { deviceJwt, expiryOf, newIdentity, PlexTv, PlexTvError } from '../src/notify/plex-auth.js';
import { PlexSession } from '../src/plex-session.js';
import { migrated } from '../src/database.js';
import { deliver } from '../src/notify/delivery.js';
import { fakePlexTv, plexToken } from './fake-plex-tv.js';
import { closeFakeServers, fakeServer } from './fake-server.js';

afterEach(closeFakeServers);

const DAY = 86_400_000;
const quiet = { info: () => undefined, warn: () => undefined };

describe('the device identity and its JWT', () => {
  it('names the key by its RFC 7638 thumbprint and signs what the public key verifies', () => {
    const identity = newIdentity();
    const jwt = deviceJwt(identity, { nonce: 'n' }, 1_700_000_000_000);
    const [header, payload, signature] = jwt.split('.') as [string, string, string];

    const { x } = JSON.parse(identity.privateJwk) as { x: string };
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      kid: identity.kid,
      alg: 'EdDSA',
      typ: 'JWT',
    });
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({
      nonce: 'n',
      aud: 'plex.tv',
      iss: identity.clientId,
      iat: 1_700_000_000,
      exp: 1_700_000_300,
    });
    expect(
      verify(
        null,
        Buffer.from(`${header}.${payload}`),
        createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' }),
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
  });

  it('reads when a token ends from its exp, and assumes a week for one it cannot read', () => {
    expect(expiryOf(plexToken(3 * DAY), 0)).toBeGreaterThan(2 * DAY);
    expect(expiryOf('not-a-jwt', 1000)).toBe(1000 + 7 * DAY);
  });
});

describe('plex.tv, step by step', () => {
  it('registers the key with the PIN, hands the token over once claimed, and renews it', async () => {
    const tv = await fakePlexTv();
    const plex = new PlexTv({ clientsUrl: tv.url });
    const identity = newIdentity();

    const pin = await plex.startPin(identity);
    const fragment = new URLSearchParams(new URL(pin.authUrl).hash.slice(2));
    expect(pin.authUrl.startsWith(`${tv.url}/auth#?`)).toBe(true);
    expect(fragment.get('clientID')).toBe(identity.clientId);
    expect(fragment.get('code')).toBe('pin-code');
    expect(fragment.get('context[device][product]')).toBe('Kinoshelf');
    expect(tv.registered()).toMatchObject({
      kty: 'OKP',
      crv: 'Ed25519',
      kid: identity.kid,
      alg: 'EdDSA',
    });
    expect(tv.registered()).not.toHaveProperty('d');

    expect(await plex.claimPin(identity, pin.id)).toBeUndefined();
    tv.claim();
    const claimed = await plex.claimPin(identity, pin.id);
    expect(claimed?.expiresAt).toBeGreaterThan(Date.now() + 6 * DAY);

    const renewed = await plex.refresh(identity);
    expect(renewed.token).not.toBe(claimed?.token);
    expect(tv.refreshes()).toBe(1);
  });

  it('is refused when the signature is not the registered key’s', async () => {
    const tv = await fakePlexTv();
    const plex = new PlexTv({ clientsUrl: tv.url });
    const identity = newIdentity();
    await plex.startPin(identity);

    const impostor = { ...newIdentity(), clientId: identity.clientId, kid: identity.kid };
    await expect(plex.refresh(impostor)).rejects.toMatchObject({ status: 422, rejected: true });
  });

  it('lists only the servers, local addresses included', async () => {
    const tv = await fakePlexTv();
    const plex = new PlexTv({ clientsUrl: tv.url });
    const identity = newIdentity();
    const token = plexToken(DAY);
    tv.valid.add(token);

    const servers = await plex.servers(identity, token);
    expect(servers.map((s) => s.name)).toEqual(['Salon']);
    expect(servers[0]?.connections).toContainEqual({
      uri: 'http://192.168.1.10:32400',
      local: true,
      relay: false,
    });
  });

  it('reports plex.tv down as unreachable, not as a refusal', async () => {
    const plex = new PlexTv({ clientsUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
    const error = await plex.refresh(newIdentity()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlexTvError);
    expect(error).toMatchObject({ status: 0, rejected: false });
  });
});

async function signedIn(options: { lifetimeMs?: number; now?: () => number } = {}) {
  const tv = await fakePlexTv(options.lifetimeMs ? { lifetimeMs: options.lifetimeMs } : {});
  const database = migrated(new Database(':memory:'));
  const clock = { at: Date.now() };
  const session = new PlexSession(
    database,
    new PlexTv({ clientsUrl: tv.url }),
    options.now ?? (() => clock.at),
  );
  const pin = await session.start();
  tv.claim();
  expect(await session.claim(pin.id)).toBe(true);
  return { tv, database, session, clock };
}

describe('the session', () => {
  it('keeps a fresh token and renews one that has under a day left', async () => {
    const { tv, session, clock } = await signedIn();
    const first = await session.token();
    expect(await session.token()).toBe(first);
    expect(tv.refreshes()).toBe(0);

    clock.at += 6.5 * DAY;
    const renewed = await session.token();
    expect(renewed).not.toBe(first);
    expect(tv.refreshes()).toBe(1);
  });

  it('renews once for concurrent callers', async () => {
    const { tv, session, clock } = await signedIn();
    clock.at += 7 * DAY + 1000; // even expired, a token can be renewed
    const tokens = await Promise.all([session.token(), session.token(), session.token()]);
    expect(new Set(tokens).size).toBe(1);
    expect(tv.refreshes()).toBe(1);
  });

  it('drops to "expired" when plex.tv refuses the key, and recovers on a new sign-in', async () => {
    const { tv, session, clock } = await signedIn();
    clock.at += 7 * DAY;
    tv.failNext(422);
    expect(await session.token()).toBeUndefined();
    expect(session.account).toEqual({ connected: true, error: true });

    const pin = await session.start();
    expect(await session.claim(pin.id)).toBe(true);
    expect(session.account).toEqual({ connected: true, error: false });
  });

  it('keeps using a token that is still good while plex.tv is down', async () => {
    const { tv, session, clock } = await signedIn();
    const first = await session.token();
    clock.at += 6.5 * DAY;
    tv.failNext(503);
    expect(await session.token()).toBe(first);
    expect(session.account.error).toBe(false);
  });

  it('only accepts the PIN it made', async () => {
    const { session } = await signedIn();
    await expect(session.claim(999)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps the device when signing out, so the next sign-in is not one more device', async () => {
    const { tv, session, database } = await signedIn();
    const clientId = (
      database.prepare('SELECT client_id FROM plex_auth').get() as { client_id: string }
    ).client_id;
    session.signOut();
    expect(session.account).toEqual({ connected: false, error: false });
    expect(await session.token()).toBeUndefined();

    await session.start();
    tv.claim();
    const after = database.prepare('SELECT client_id FROM plex_auth').get() as {
      client_id: string;
    };
    expect(after.client_id).toBe(clientId);
  });
});

describe('the media server client with a signed-in token', () => {
  it('sends the session token, and renews once when the server refuses it', async () => {
    const { tv, session } = await signedIn();
    const first = await session.token();
    // The media server drops that token (revoked) and accepts the next one.
    const pms = await fakeServer((r) =>
      r.headers['x-plex-token'] === first
        ? { status: 401 }
        : {
            body: '<MediaContainer><Directory key="1" type="movie"><Location path="/m"/></Directory></MediaContainer>',
          },
    );
    const client = new PlexClient(
      { url: pms.url, token: session },
      (r) => deliver(r, { delays: [] }),
      quiet,
    );

    const result = await client.check();
    expect(result).toMatchObject({ ok: true, sections: 1 });
    expect(pms.received.map((r) => r.headers['x-plex-token'])).toEqual([
      first,
      expect.not.stringMatching(String(first)),
    ]);
    expect(tv.refreshes()).toBe(1);
  });

  it('does not call the server at all when signed out', async () => {
    const { session } = await signedIn();
    session.signOut();
    const pms = await fakeServer();
    const client = new PlexClient(
      { url: pms.url, token: session },
      (r) => deliver(r, { delays: [] }),
      quiet,
    );
    expect((await client.check()).ok).toBe(false);
    expect(pms.received).toHaveLength(0);
  });
});
