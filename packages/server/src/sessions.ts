import { createHash, randomBytes } from 'node:crypto';
import type { Database } from 'better-sqlite3';

export const SESSION_COOKIE = 'kinoshelf_session';

/** A session of the UI lasts a week; using it does not extend it, so a stolen cookie ages out. */
export const SESSION_TTL_MS = 7 * 86_400_000;

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Opens a session and returns its token, which only the browser's cookie ever holds. */
export function createSession(database: Database, now = new Date()): string {
  const token = randomBytes(32).toString('base64url');
  database
    .prepare('INSERT INTO sessions (hash, created_at, expires_at) VALUES (?, ?, ?)')
    .run(hash(token), now.toISOString(), new Date(now.getTime() + SESSION_TTL_MS).toISOString());
  // Expired rows are only ever read through `isValidSession`; sweeping here keeps the table small.
  database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
  return token;
}

export function isValidSession(database: Database, token: string, now = new Date()): boolean {
  return (
    database
      .prepare('SELECT 1 FROM sessions WHERE hash = ? AND expires_at > ?')
      .get(hash(token), now.toISOString()) !== undefined
  );
}

export function endSession(database: Database, token: string): void {
  database.prepare('DELETE FROM sessions WHERE hash = ?').run(hash(token));
}

/** The value of one cookie, without a parser: the UI sets a single one. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      return value.join('=');
    }
  }
  return undefined;
}

/** `Secure` only over HTTPS, otherwise a UI served on a LAN address would never log in. */
export function sessionCookie(
  token: string,
  options: { secure: boolean; maxAgeMs: number },
): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(options.maxAgeMs / 1000)}`,
    ...(options.secure ? ['Secure'] : []),
  ].join('; ');
}
