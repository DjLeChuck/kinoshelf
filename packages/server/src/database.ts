import type { Database } from '@kinoshelf/core';
import { applyMigrations, openConfigDatabase } from '@kinoshelf/core';

/** Same rules as the core's migrations: append, never edit a shipped entry. */
export const SERVER_MIGRATIONS: readonly { readonly name: string; readonly sql: string }[] = [
  {
    name: 'server:001-initial',
    sql: `
      CREATE TABLE api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE sessions (
        hash TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE onboarding_state (
        key TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK (state IN ('done', 'skipped')),
        at TEXT NOT NULL
      );

      -- The Plex sign-in (one row): a secret that changes every week does not belong in a file.
      CREATE TABLE plex_auth (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        client_id TEXT NOT NULL,
        private_jwk TEXT NOT NULL,
        kid TEXT NOT NULL,
        token TEXT,
        expires_at INTEGER,
        pin_id INTEGER
      );

      CREATE TABLE jobs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        path TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        error TEXT,
        apply INTEGER NOT NULL DEFAULT 0,
        settings TEXT,
        library_id TEXT,
        rescan INTEGER NOT NULL DEFAULT 0,
        candidate TEXT
      );
      CREATE INDEX jobs_library ON jobs (library_id, seq);
      CREATE INDEX jobs_path ON jobs (path);
      CREATE INDEX jobs_status ON jobs (status, seq);

      -- One compact row per file of an analysis, so a 20 000-file library is read page by page.
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
        batch_id TEXT,
        destination_library_id TEXT,
        release TEXT,
        cluster INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX job_entries_batch ON job_entries (batch_id);
      CREATE INDEX job_entries_job ON job_entries (job_id, seq);
      CREATE INDEX job_entries_release ON job_entries (job_id, release);
      CREATE INDEX job_entries_state ON job_entries (job_id, classification, resolution);

      CREATE TABLE executions (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        job_id TEXT NOT NULL,
        status TEXT NOT NULL,
        entry_ids TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        batch_id TEXT,
        summary TEXT,
        error TEXT,
        failures TEXT
      );
      CREATE INDEX executions_batch ON executions (batch_id);
      CREATE INDEX executions_job ON executions (job_id, seq);
      CREATE INDEX executions_status ON executions (status, seq);

      CREATE TABLE watched_files (
        path TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        submitted_at TEXT NOT NULL,
        PRIMARY KEY (path, size, mtime_ms)
      );

      -- What a typed library holds, as its last scan saw it: one row per file.
      CREATE TABLE library_items (
        library_id TEXT NOT NULL,
        path TEXT NOT NULL,
        item_id TEXT,
        kind TEXT,
        tmdb_id INTEGER,
        title TEXT,
        year INTEGER,
        state TEXT NOT NULL,
        nfo INTEGER,
        poster INTEGER,
        fanart INTEGER,
        logo INTEGER,
        thumb INTEGER,
        unavailable TEXT,
        season INTEGER,
        episode INTEGER,
        episode_end INTEGER,
        entry_id TEXT,
        scan_job_id TEXT,
        scanned_at TEXT NOT NULL,
        video TEXT,
        audio TEXT,
        hdr TEXT,
        audio_languages TEXT,
        subtitle_languages TEXT,
        picture TEXT,
        size INTEGER,
        mtime INTEGER,
        probed_at TEXT,
        sort TEXT,
        work_key TEXT,
        search_key TEXT,
        collection_key TEXT,
        collection_name TEXT,
        collection_total INTEGER,
        PRIMARY KEY (library_id, path)
      );
      CREATE INDEX library_items_collection ON library_items (library_id, collection_key);
      CREATE INDEX library_items_item ON library_items (library_id, item_id);
      CREATE INDEX library_items_scan ON library_items (scan_job_id);
      CREATE INDEX library_items_show ON library_items (library_id, tmdb_id);
      CREATE INDEX library_items_state ON library_items (library_id, state);
      CREATE INDEX library_items_work ON library_items (library_id, work_key);

      -- A cache of library_items, one row per show, settled when read (LibraryItemStore.settleShows).
      CREATE TABLE library_shows (
        library_id TEXT NOT NULL,
        tmdb_id INTEGER NOT NULL,
        title TEXT,
        year INTEGER,
        sort TEXT,
        seasons INTEGER NOT NULL,
        rename INTEGER NOT NULL,
        refresh INTEGER NOT NULL,
        has_review INTEGER NOT NULL,
        has_unrecognized INTEGER NOT NULL,
        has_missing_nfo INTEGER NOT NULL,
        has_missing_artwork INTEGER NOT NULL,
        multi INTEGER NOT NULL,
        incomplete_versions INTEGER NOT NULL,
        PRIMARY KEY (library_id, tmdb_id)
      ) WITHOUT ROWID;
      CREATE INDEX library_shows_sort ON library_shows (library_id, sort, tmdb_id);

      -- The same for a movie library: one row per list entry (LibraryItemStore.settleWorks).
      CREATE TABLE library_works (
        library_id TEXT NOT NULL,
        work_key TEXT NOT NULL,
        lead_path TEXT NOT NULL,
        title TEXT,
        year INTEGER,
        sort TEXT,
        n_files INTEGER NOT NULL,
        has_review INTEGER NOT NULL,
        has_rename INTEGER NOT NULL,
        has_unrecognized INTEGER NOT NULL,
        has_missing_nfo INTEGER NOT NULL,
        has_missing_artwork INTEGER NOT NULL,
        multi INTEGER NOT NULL,
        collection_key TEXT,
        collection_name TEXT,
        collection_sort TEXT,
        collection_total INTEGER,
        PRIMARY KEY (library_id, work_key)
      ) WITHOUT ROWID;
      CREATE INDEX library_works_collection ON library_works (library_id, collection_key);
      CREATE INDEX library_works_sort ON library_works (library_id, sort, lead_path);

      CREATE TABLE series_completeness (
        library_id TEXT NOT NULL,
        tmdb_id INTEGER NOT NULL,
        missing INTEGER NOT NULL,
        signature TEXT NOT NULL,
        computed_at TEXT NOT NULL,
        PRIMARY KEY (library_id, tmdb_id)
      );

      CREATE TABLE series_files (
        library_id TEXT NOT NULL,
        tmdb_id INTEGER NOT NULL,
        season INTEGER NOT NULL,
        nfo INTEGER,
        poster INTEGER,
        fanart INTEGER,
        logo INTEGER,
        PRIMARY KEY (library_id, tmdb_id, season)
      );

      CREATE TABLE collections (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        overview TEXT,
        parts TEXT NOT NULL
      );

      CREATE TABLE movie_collections (
        movie_id INTEGER PRIMARY KEY,
        collection_id INTEGER NOT NULL
      );

      -- The owner's choice, apart from TMDB's: a scan never writes it.
      CREATE TABLE collection_overrides (
        library_id TEXT NOT NULL,
        movie_id INTEGER NOT NULL,
        mode TEXT NOT NULL,
        name TEXT,
        PRIMARY KEY (library_id, movie_id)
      );
    `,
  },
];

/** Opens the single SQLite file of the config directory, shared with the CLI and the cache. */
export async function openDatabase(configDir: string): Promise<Database> {
  return migrated(await openConfigDatabase(configDir));
}

export function migrated(database: Database): Database {
  applyMigrations(database, SERVER_MIGRATIONS);
  return database;
}
