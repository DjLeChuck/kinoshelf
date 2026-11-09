import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  type webcrypto,
} from 'node:crypto';

type JsonWebKey = webcrypto.JsonWebKey;

/**
 * Plex's JWT sign-in (https://developer.plex.tv/pms/#section/API-Info/Authenticating-with-Plex).
 * The device holds an Ed25519 key and registers its public half; plex.tv then hands out tokens that
 * last seven days and are renewed by signing a nonce, so nothing is ever typed or pasted. The
 * token is used as `X-Plex-Token`, on plex.tv and on the media server alike.
 */

export const PLEX_PRODUCT = 'Kinoshelf';
const DEFAULT_CLIENTS_URL = 'https://clients.plex.tv';
const DEFAULT_APP_URL = 'https://app.plex.tv';
/** A device JWT is only read once: five minutes is plenty and bounds a leaked one. */
const DEVICE_JWT_TTL_S = 300;
const TOKEN_LIFETIME_MS = 7 * 86_400_000;

/** What a device keeps between runs: who it is, and the key that proves it. */
export interface PlexIdentity {
  readonly clientId: string;
  /** The private key as a JWK, JSON-encoded (it holds `d`). */
  readonly privateJwk: string;
  readonly kid: string;
}

export interface PlexToken {
  readonly token: string;
  /** Epoch milliseconds, from the token's own `exp`. */
  readonly expiresAt: number;
}

export interface PlexConnection {
  readonly uri: string;
  readonly local: boolean;
  readonly relay: boolean;
}

export interface PlexServer {
  readonly name: string;
  readonly owned: boolean;
  readonly connections: readonly PlexConnection[];
}

/** plex.tv answered, but not with what a sign-in needs. `status` 0 means it was not reached. */
export class PlexTvError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PlexTvError';
  }

  /** The answer says the credentials are wrong (rather than plex.tv being down or us being slow). */
  get rejected(): boolean {
    return this.status === 401 || this.status === 403 || this.status === 422 || this.status === 498;
  }
}

const base64url = (data: Buffer | string): string => Buffer.from(data).toString('base64url');

/** The RFC 7638 thumbprint of an Ed25519 public key: a stable name for the key. */
function thumbprint(x: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ crv: 'Ed25519', kty: 'OKP', x }))
    .digest('base64url');
}

/** A new device: an id and an Ed25519 key pair, which stay the same for as long as it signs in. */
export function newIdentity(): PlexIdentity {
  const { privateKey } = generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' });
  return {
    clientId: randomUUID(),
    privateJwk: JSON.stringify(jwk),
    kid: thumbprint(String(jwk.x)),
  };
}

function publicJwk(identity: PlexIdentity): Record<string, string> {
  const { x } = JSON.parse(identity.privateJwk) as JsonWebKey;
  return { kty: 'OKP', crv: 'Ed25519', x: String(x), kid: identity.kid, alg: 'EdDSA' };
}

/** A JWT signed with the device's key, as plex.tv's two calls expect it. */
export function deviceJwt(
  identity: PlexIdentity,
  claims: Record<string, unknown>,
  nowMs: number,
): string {
  const iat = Math.floor(nowMs / 1000);
  const header = { kid: identity.kid, alg: 'EdDSA', typ: 'JWT' };
  const payload = {
    ...claims,
    aud: 'plex.tv',
    iss: identity.clientId,
    iat,
    exp: iat + DEVICE_JWT_TTL_S,
  };
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const key = createPrivateKey({
    key: JSON.parse(identity.privateJwk) as JsonWebKey,
    format: 'jwk',
  });
  return `${input}.${base64url(sign(null, Buffer.from(input), key))}`;
}

/** When a token stops being good: its own `exp`, else a week from `nowMs`. */
export function expiryOf(token: string, nowMs: number): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as {
      exp?: unknown;
    };
    if (typeof payload.exp === 'number') {
      return payload.exp * 1000;
    }
  } catch {
    // not a JWT: a legacy token, or something we cannot read
  }
  return nowMs + TOKEN_LIFETIME_MS;
}

export interface PlexTvOptions {
  readonly fetch?: typeof fetch;
  /** `KINOSHELF_PLEX_TV_URL`: a fake plex.tv in the end-to-end tests. */
  readonly clientsUrl?: string;
  readonly appUrl?: string;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/** The calls of the JWT flow, over `fetch` so a test (or the fake plex.tv) can stand in. */
export class PlexTv {
  private readonly clientsUrl: string;
  private readonly appUrl: string;

  constructor(private readonly options: PlexTvOptions = {}) {
    this.clientsUrl = (options.clientsUrl ?? DEFAULT_CLIENTS_URL).replace(/\/+$/, '');
    this.appUrl = (options.appUrl ?? options.clientsUrl ?? DEFAULT_APP_URL).replace(/\/+$/, '');
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** Step 1: a PIN tied to the device's public key, and the page where the user claims it. */
  async startPin(identity: PlexIdentity): Promise<{ id: number; authUrl: string }> {
    const body = await this.call(identity, 'POST', '/api/v2/pins', {
      body: { jwk: publicJwk(identity), strong: true },
    });
    const { id, code } = asRecord(body);
    if (typeof id !== 'number' || typeof code !== 'string') {
      throw new PlexTvError(502, 'plex.tv sent a PIN without id or code');
    }
    const fragment = new URLSearchParams({
      clientID: identity.clientId,
      code,
      'context[device][product]': PLEX_PRODUCT,
    });
    return { id, authUrl: `${this.appUrl}/auth#?${fragment.toString()}` };
  }

  /** Step 3: the token, once the user has claimed the PIN; `undefined` while they have not. */
  async claimPin(identity: PlexIdentity, id: number): Promise<PlexToken | undefined> {
    const jwt = deviceJwt(identity, {}, this.now());
    const body = await this.call(
      identity,
      'GET',
      `/api/v2/pins/${String(id)}?deviceJWT=${encodeURIComponent(jwt)}`,
    );
    const { authToken } = asRecord(body);
    return typeof authToken === 'string' && authToken !== ''
      ? { token: authToken, expiresAt: expiryOf(authToken, this.now()) }
      : undefined;
  }

  /** A new token for seven days: a nonce, signed with the key. Works after the old one expired. */
  async refresh(identity: PlexIdentity): Promise<PlexToken> {
    const { nonce } = asRecord(await this.call(identity, 'GET', '/api/v2/auth/nonce'));
    if (typeof nonce !== 'string') {
      throw new PlexTvError(502, 'plex.tv sent no nonce');
    }
    const jwt = deviceJwt(identity, { nonce, scope: 'username' }, this.now());
    const answer = asRecord(
      await this.call(identity, 'POST', '/api/v2/auth/token', { body: { jwt } }),
    );
    const token = answer.auth_token;
    if (typeof token !== 'string' || token === '') {
      throw new PlexTvError(502, 'plex.tv sent no token');
    }
    return { token, expiresAt: expiryOf(token, this.now()) };
  }

  /** The media servers of the account, to pick the address of one instead of typing it. */
  async servers(identity: PlexIdentity, token: string): Promise<PlexServer[]> {
    const body = await this.call(
      identity,
      'GET',
      '/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1',
      { token },
    );
    const resources = Array.isArray(body) ? (body as unknown[]) : [];
    return resources.flatMap((entry) => {
      const resource = asRecord(entry);
      if (
        typeof resource.provides !== 'string' ||
        !resource.provides.split(',').includes('server')
      ) {
        return [];
      }
      const connections = Array.isArray(resource.connections)
        ? (resource.connections as unknown[])
        : [];
      return [
        {
          name: String(resource.name),
          owned: resource.owned === true,
          connections: connections.flatMap((connection) => {
            const { uri, local, relay } = asRecord(connection);
            return typeof uri === 'string'
              ? [{ uri, local: local === true, relay: relay === true }]
              : [];
          }),
        },
      ];
    });
  }

  private async call(
    identity: PlexIdentity,
    method: 'GET' | 'POST',
    path: string,
    extra: { body?: unknown; token?: string } = {},
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Plex-Product': PLEX_PRODUCT,
      'X-Plex-Client-Identifier': identity.clientId,
      ...(extra.token !== undefined && { 'X-Plex-Token': extra.token }),
      ...(extra.body !== undefined && { 'Content-Type': 'application/json' }),
    };
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(`${this.clientsUrl}${path}`, {
        method,
        headers,
        ...(extra.body !== undefined && { body: JSON.stringify(extra.body) }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
        redirect: 'error',
      });
    } catch (error) {
      throw new PlexTvError(0, error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) {
      throw new PlexTvError(response.status, `plex.tv answered ${String(response.status)}`);
    }
    const answer: unknown = await response.json().catch(() => undefined);
    return answer;
  }
}
