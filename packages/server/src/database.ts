import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations, DATABASE_FILE } from '@kinoshelf/core';

/** Same rules as the core's migrations: append, never edit a shipped entry. */
export const SERVER_MIGRATIONS: readonly { readonly name: string; readonly sql: string }[] = [
  {
    name: 'server:001-jobs',
    sql: `
      CREATE TABLE jobs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        path TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        error TEXT,
        summary TEXT,
        analysis TEXT
      );
      CREATE INDEX jobs_status ON jobs (status, seq);
    `,
  },
  {
    name: 'server:002-api-keys',
    sql: `
      CREATE TABLE api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    // Replaces the analysis blob of the jobs table (about 6 KB per file, reparsed on every read)
    // with one compact row per file, so a 20 000-file library is read page by page.
    name: 'server:003-job-entries',
    sql: `
      CREATE TABLE job_entries (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        job_id TEXT NOT NULL,
        path TEXT NOT NULL,
        classification TEXT NOT NULL,
        resolution TEXT,
        parsed TEXT NOT NULL,
        outcome TEXT NOT NULL,
        item TEXT,
        error TEXT,
        batch_id TEXT
      );
      CREATE INDEX job_entries_job ON job_entries (job_id, seq);
      CREATE INDEX job_entries_batch ON job_entries (batch_id);
      ALTER TABLE jobs ADD COLUMN apply INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE jobs ADD COLUMN batch_id TEXT;
      ALTER TABLE jobs ADD COLUMN settings TEXT;
      ALTER TABLE jobs DROP COLUMN summary;
      ALTER TABLE jobs DROP COLUMN analysis;
    `,
  },
];

/** Opens the single SQLite file of the config directory, shared with the CLI and the cache. */
export function openDatabase(configDir: string): Database.Database {
  mkdirSync(configDir, { recursive: true });
  return migrated(new Database(join(configDir, DATABASE_FILE)));
}

export function migrated(database: Database.Database): Database.Database {
  applyMigrations(database, SERVER_MIGRATIONS);
  return database;
}
