import { createPublicKey, verify, type webcrypto } from 'node:crypto';
import { fakeServer, type Received } from './fake-server.js';

type Jwk = webcrypto.JsonWebKey & { kid?: string; alg?: string };

const decode = (part: string | undefined): Record<string, unknown> =>
  JSON.parse(Buffer.from(part ?? '', 'base64url').toString()) as Record<string, unknown>;

/** A token shaped like Plex's: a JWT whose `exp` is what the client reads. */
export function plexToken(expiresInMs: number, label = 'token'): string {
  const part = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'EdDSA' })}.${part({ exp: Math.floor((Date.now() + expiresInMs) / 1000), label })}.sig`;
}

export interface FakePlexTv {
  readonly url: string;
  readonly received: Received[];
  /** The user claims the PIN on app.plex.tv. */
  claim(): void;
  /** Tokens still valid, as plex.tv's own accepts them (the media server's too). */
  readonly valid: Set<string>;
  /** Fail the next calls to the given path with a status (0 closes nothing: use a bad status). */
  failNext(status: number): void;
  readonly registered: () => Jwk | undefined;
  /** How many tokens were issued by `POST /api/v2/auth/token`. */
  readonly refreshes: () => number;
}

/**
 * plex.tv's JWT flow as the documentation describes it. It checks what a real one would: the
 * signature of each device JWT against the key registered with the PIN, its audience and issuer,
 * and that a nonce is used once, so a client that signs wrongly fails here as it would there.
 */
export async function fakePlexTv(
  options: { lifetimeMs?: number; servers?: object[] } = {},
): Promise<FakePlexTv> {
  const lifetimeMs = options.lifetimeMs ?? 7 * 86_400_000;
  let jwk: Jwk | undefined;
  let claimed = false;
  let failing: number | undefined;
  let nonces = 0;
  let refreshes = 0;
  let issued = 0;
  const open = new Set<string>();
  const valid = new Set<string>();

  const proves = (
    jwt: string,
    clientId: string | undefined,
  ): Record<string, unknown> | undefined => {
    const [header, payload, signature] = jwt.split('.');
    if (!jwk || !header || !payload || !signature) {
      return undefined;
    }
    const head = decode(header);
    const claims = decode(payload);
    const ok =
      head.kid === jwk.kid &&
      head.alg === 'EdDSA' &&
      claims.aud === 'plex.tv' &&
      claims.iss === clientId &&
      verify(
        null,
        Buffer.from(`${header}.${payload}`),
        createPublicKey({ key: jwk, format: 'jwk' }),
        Buffer.from(signature, 'base64url'),
      );
    return ok ? claims : undefined;
  };
  const issue = (): string => {
    const token = plexToken(lifetimeMs, `issued-${String(++issued)}`);
    valid.add(token);
    return token;
  };
  const reply = (body: unknown, status = 200): { status: number; body: string } => ({
    status,
    body: JSON.stringify(body),
  });

  const server = await fakeServer((request) => {
    if (failing !== undefined) {
      const status = failing;
      failing = undefined;
      return reply({}, status);
    }
    const url = new URL(request.url, 'http://plex.test');
    const clientId = request.headers['x-plex-client-identifier'] as string | undefined;
    const body = request.body === '' ? {} : (JSON.parse(request.body) as Record<string, unknown>);

    if (request.method === 'POST' && url.pathname === '/api/v2/pins') {
      jwk = body.jwk as Jwk;
      return reply({ id: 111, code: 'pin-code' });
    }
    if (url.pathname === '/api/v2/pins/111') {
      const jwt = url.searchParams.get('deviceJWT');
      if (!jwt || !proves(jwt, clientId)) {
        return reply({}, 422);
      }
      return reply({ authToken: claimed ? issue() : null });
    }
    if (url.pathname === '/api/v2/auth/nonce') {
      const nonce = `nonce-${String(++nonces)}`;
      open.add(nonce);
      return reply({ nonce });
    }
    if (request.method === 'POST' && url.pathname === '/api/v2/auth/token') {
      const claims = proves(String(body.jwt), clientId);
      if (!claims || !open.delete(String(claims.nonce))) {
        return reply({}, 422);
      }
      refreshes++;
      return reply({ auth_token: issue() });
    }
    if (url.pathname === '/api/v2/resources') {
      const token = request.headers['x-plex-token'] as string | undefined;
      return token !== undefined && valid.has(token)
        ? reply(
            options.servers ?? [
              {
                name: 'Salon',
                provides: 'server',
                owned: true,
                connections: [
                  { uri: 'https://relay.plex.direct:8443', local: false, relay: true },
                  { uri: 'http://192.168.1.10:32400', local: true, relay: false },
                ],
              },
              { name: 'Phone', provides: 'player', owned: true, connections: [] },
            ],
          )
        : reply({}, 401);
    }
    return reply({}, 404);
  });

  return {
    url: server.url,
    received: server.received,
    claim: () => {
      claimed = true;
    },
    valid,
    failNext: (status) => {
      failing = status;
    },
    registered: () => jwk,
    refreshes: () => refreshes,
  };
}
