import { createHash, randomBytes } from 'node:crypto';
import type { Database } from 'better-sqlite3';

/** Short enough to guess is not a key: a value given through the environment must be long. */
export const MIN_API_KEY_LENGTH = 32;

const hash = (key: string): string => createHash('sha256').update(key).digest('hex');

export function generateApiKey(): string {
  return `ks_${randomBytes(24).toString('base64url')}`;
}

/**
 * Makes `key` the only valid key. Only its hash is stored, so a key cannot be read back: it is
 * either chosen by the operator (environment) or shown once to the one who asked for it.
 */
export function setApiKey(database: Database, key: string): void {
  database.transaction(() => {
    database.prepare('DELETE FROM api_keys').run();
    database
      .prepare('INSERT INTO api_keys (hash, created_at) VALUES (?, ?)')
      .run(hash(key), new Date().toISOString());
  })();
}

export function hasApiKey(database: Database): boolean {
  return database.prepare('SELECT 1 FROM api_keys LIMIT 1').get() !== undefined;
}

/** Keys are long random values, so comparing their hashes is enough (no timing side channel). */
export function isValidApiKey(database: Database, candidate: string): boolean {
  return (
    database.prepare('SELECT 1 FROM api_keys WHERE hash = ?').get(hash(candidate)) !== undefined
  );
}
