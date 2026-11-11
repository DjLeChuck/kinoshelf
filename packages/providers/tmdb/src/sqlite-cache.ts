import type { Database } from '@kinoshelf/core';
import type { CacheEntry, HttpCache } from './cache.js';

/**
 * Cache stored in the caller's SQLite database (the single file in `/config`).
 * The table is created on demand: it is disposable data, so it needs no migration history.
 */
export class SqliteHttpCache implements HttpCache {
  constructor(private readonly db: Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS tmdb_http_cache (
      key TEXT PRIMARY KEY NOT NULL,
      status INTEGER NOT NULL,
      body TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tmdb_http_cache_expires ON tmdb_http_cache (expires_at)`);
  }

  get(key: string, now: number): CacheEntry | undefined {
    const row = this.db
      .prepare<[string], { status: number; body: string; expires_at: number }>(
        'SELECT status, body, expires_at FROM tmdb_http_cache WHERE key = ?',
      )
      .get(key);
    return row && row.expires_at > now ? { status: row.status, body: row.body } : undefined;
  }

  set(key: string, entry: CacheEntry, expiresAt: number): void {
    this.db
      .prepare(
        `INSERT INTO tmdb_http_cache (key, status, body, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET
           status = excluded.status, body = excluded.body, expires_at = excluded.expires_at`,
      )
      .run(key, entry.status, entry.body, expiresAt);
  }

  /** Deletes expired rows; returns how many were removed. */
  prune(now: number): number {
    return this.db.prepare('DELETE FROM tmdb_http_cache WHERE expires_at < ?').run(now).changes;
  }
}
