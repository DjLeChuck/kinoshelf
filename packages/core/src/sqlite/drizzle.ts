import { BetterSQLiteSession } from 'drizzle-orm/better-sqlite3/session';
import { BaseSQLiteDatabase, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { Database, RunResult } from './database.js';

/** A Drizzle handle on a `Database`, synchronous like the driver under it. */
export type DrizzleDatabase = BaseSQLiteDatabase<'sync', RunResult>;

/**
 * Drizzle's `better-sqlite3` driver, built by hand. Its `drizzle()` entry imports the native
 * module to be able to open a database from a path, which this project no longer installs; the
 * session class only needs the API `Database` has, so it is assembled here the way `drizzle()`
 * does for a client it is given.
 */
export function drizzleOf(client: Database): DrizzleDatabase {
  const dialect = new SQLiteSyncDialect();
  const session = new BetterSQLiteSession(client, dialect, undefined);
  return new BaseSQLiteDatabase('sync', dialect, session, undefined) as DrizzleDatabase;
}
