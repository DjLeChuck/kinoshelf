import { eq, lt } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Database } from 'better-sqlite3';
import type { CacheEntry, HttpCache } from './cache.js';

export const httpCache = sqliteTable('tmdb_http_cache', {
  key: text('key').primaryKey(),
  status: integer('status').notNull(),
  body: text('body').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

/**
 * Cache stored in the caller's SQLite database (the single file in `/config`).
 * The table is created on demand: it is disposable data, so it needs no migration history.
 */
export class SqliteHttpCache implements HttpCache {
  private readonly db: BetterSQLite3Database;

  constructor(sqlite: Database) {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS tmdb_http_cache (
      key TEXT PRIMARY KEY NOT NULL,
      status INTEGER NOT NULL,
      body TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
    this.db = drizzle(sqlite);
  }

  get(key: string, now: number): CacheEntry | undefined {
    const row = this.db.select().from(httpCache).where(eq(httpCache.key, key)).get();
    return row && row.expiresAt > now ? { status: row.status, body: row.body } : undefined;
  }

  set(key: string, entry: CacheEntry, expiresAt: number): void {
    const values = { key, status: entry.status, body: entry.body, expiresAt };
    this.db
      .insert(httpCache)
      .values(values)
      .onConflictDoUpdate({ target: httpCache.key, set: values })
      .run();
  }

  /** Deletes expired rows; returns how many were removed. */
  prune(now: number): number {
    return this.db.delete(httpCache).where(lt(httpCache.expiresAt, now)).run().changes;
  }
}
