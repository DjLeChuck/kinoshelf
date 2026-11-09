import type { Database } from 'better-sqlite3';
import {
  newIdentity,
  PlexTv,
  PlexTvError,
  type PlexIdentity,
  type PlexServer,
  type PlexToken,
} from './notify/plex-auth.js';

interface Row {
  client_id: string;
  private_jwk: string;
  kid: string;
  token: string | null;
  expires_at: number | null;
  pin_id: number | null;
}

/** Renewed a day before it ends, so a transfer never meets an expired token. */
const RENEW_BEFORE_MS = 86_400_000;

export interface PlexAccount {
  /** A token is held (it may still fail to renew: see `error`). */
  readonly connected: boolean;
  /** The last renewal plex.tv refused: the user has to sign in again. */
  readonly error: boolean;
}

/**
 * The device's sign-in to Plex, kept in the database: its identity, the current token and the PIN
 * being claimed. `token()` is what the media-server client asks before each call, and renews on
 * the way, one renewal at a time.
 */
export class PlexSession {
  private renewing: Promise<string | undefined> | undefined;
  private failed = false;

  constructor(
    private readonly database: Database,
    private readonly tv: PlexTv = new PlexTv(),
    private readonly now: () => number = Date.now,
  ) {}

  private row(): Row | undefined {
    return this.database.prepare('SELECT * FROM plex_auth WHERE id = 1').get() as Row | undefined;
  }

  private identityOf(row: Row): PlexIdentity {
    return { clientId: row.client_id, privateJwk: row.private_jwk, kid: row.kid };
  }

  /** The device's identity, made on the first sign-in and the same afterwards. */
  private identity(): PlexIdentity {
    const row = this.row();
    if (row) {
      return this.identityOf(row);
    }
    const identity = newIdentity();
    this.database
      .prepare('INSERT INTO plex_auth (id, client_id, private_jwk, kid) VALUES (1, ?, ?, ?)')
      .run(identity.clientId, identity.privateJwk, identity.kid);
    return identity;
  }

  get account(): PlexAccount {
    return { connected: Boolean(this.row()?.token), error: this.failed };
  }

  /** Asks plex.tv for a PIN; the user opens `authUrl` and the web then polls `claim`. */
  async start(): Promise<{ id: number; authUrl: string }> {
    const pin = await this.tv.startPin(this.identity());
    this.database.prepare('UPDATE plex_auth SET pin_id = ? WHERE id = 1').run(pin.id);
    return pin;
  }

  /** Whether the user has claimed the PIN; keeps the token if so. Only the PIN we made counts. */
  async claim(id: number): Promise<boolean> {
    const row = this.row();
    if (row?.pin_id !== id) {
      throw new PlexTvError(404, 'unknown PIN');
    }
    const token = await this.tv.claimPin(this.identityOf(row), id);
    if (!token) {
      return false;
    }
    this.save(token);
    this.database.prepare('UPDATE plex_auth SET pin_id = NULL WHERE id = 1').run();
    return true;
  }

  private save(token: PlexToken): void {
    this.failed = false;
    this.database
      .prepare('UPDATE plex_auth SET token = ?, expires_at = ? WHERE id = 1')
      .run(token.token, token.expiresAt);
  }

  /** The token to use now, renewed first when it is about to end; `undefined` when not signed in. */
  token(): Promise<string | undefined> {
    const row = this.row();
    if (!row?.token) {
      return Promise.resolve(undefined);
    }
    if ((row.expires_at ?? 0) - this.now() > RENEW_BEFORE_MS) {
      return Promise.resolve(row.token);
    }
    return this.renew();
  }

  /**
   * A new token, whatever the old one says (a media server may refuse one that plex.tv still
   * counts good). A refusal means the key no longer works: the sign-in is dropped, not retried.
   */
  renew(): Promise<string | undefined> {
    this.renewing ??= this.doRenew().finally(() => {
      this.renewing = undefined;
    });
    return this.renewing;
  }

  private async doRenew(): Promise<string | undefined> {
    const row = this.row();
    if (!row?.token) {
      return undefined;
    }
    try {
      const token = await this.tv.refresh(this.identityOf(row));
      this.save(token);
      return token.token;
    } catch (error) {
      if (error instanceof PlexTvError && error.rejected) {
        this.failed = true;
        return undefined;
      }
      // plex.tv down or slow: the old token may still be good for a while
      return row.expires_at !== null && row.expires_at > this.now() ? row.token : undefined;
    }
  }

  /** The servers of the account, for the user to pick one. */
  async servers(): Promise<PlexServer[]> {
    const token = await this.token();
    if (token === undefined) {
      throw new PlexTvError(401, 'not signed in');
    }
    return this.tv.servers(this.identity(), token);
  }

  signOut(): void {
    this.failed = false;
    // The identity stays: a new sign-in is the same device, not one more in Plex's authorized list.
    this.database
      .prepare('UPDATE plex_auth SET token = NULL, expires_at = NULL, pin_id = NULL WHERE id = 1')
      .run();
  }
}
