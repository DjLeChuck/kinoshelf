import type Database from 'better-sqlite3';
import { applyMigrations, openConfigDatabase } from '@kinoshelf/core';

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
  {
    // A transfer can last minutes, so it is a queued record, not a request: it survives a restart
    // and a second one for the same job can be refused while one is pending.
    name: 'server:004-executions',
    sql: `
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
        error TEXT
      );
      CREATE INDEX executions_status ON executions (status, seq);
      CREATE INDEX executions_job ON executions (job_id, seq);
      ALTER TABLE jobs DROP COLUMN batch_id;
    `,
  },
  {
    // Sessions of the web UI. Like API keys, only a hash is stored: a copy of the database does
    // not let anyone in.
    name: 'server:005-sessions',
    sql: `
      CREATE TABLE sessions (
        hash TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `,
  },
  {
    // A file that fails goes back to the queue, where a later attempt may settle it, so its entry
    // cannot tell what happened in this execution. The history keeps it here.
    name: 'server:006-execution-failures',
    sql: 'ALTER TABLE executions ADD COLUMN failures TEXT;',
  },
  {
    // What a validation taught: a title (as a file spells it) tied to a work. The work's own title
    // is kept to list the alias without asking the provider.
    name: 'server:007-title-aliases',
    sql: `
      CREATE TABLE title_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        year INTEGER,
        provider TEXT NOT NULL,
        work_id INTEGER NOT NULL,
        work_title TEXT NOT NULL,
        work_year INTEGER,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    // What the folder watcher already submitted, by what identifies a download: a file that is
    // replaced (other size or date) is new again; one that stays (copy, hardlink) is not.
    name: 'server:008-watched-files',
    sql: `
      CREATE TABLE watched_files (
        path TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        submitted_at TEXT NOT NULL,
        PRIMARY KEY (path, size, mtime_ms)
      );
    `,
  },
  {
    name: 'server:009-onboarding',
    sql: `
      CREATE TABLE onboarding_state (
        key TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK (state IN ('done', 'skipped')),
        at TEXT NOT NULL
      );
    `,
  },
  {
    // A job started from a library (a scan, or a release its watched folder submitted) says which:
    // the library's profile, mode and threshold applied, and its last scan is the latest such job.
    name: 'server:010-job-library',
    sql: `
      ALTER TABLE jobs ADD COLUMN library_id TEXT;
      CREATE INDEX jobs_library ON jobs (library_id, seq);
    `,
  },
  {
    // What the user chose to remember about where a work goes ("Remember for this work"): a work
    // and a library. A library that no longer exists is not an error, the work just goes back to
    // the default destination. Durable like the aliases: it is a decision.
    name: 'server:011-work-destinations',
    sql: `
      CREATE TABLE work_destinations (
        kind TEXT NOT NULL,
        tmdb_id INTEGER NOT NULL,
        library_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (kind, tmdb_id)
      );
    `,
  },
  {
    // What a library holds, as its last scan saw it, so the page lists it without reading the disk
    // or asking TMDB again. A snapshot: replaced as a whole when a scan ends, patched by path after
    // a transfer. `nfo`, `poster` and `fanart` are 1 or 0, NULL when the profile writes no such
    // file; `season` and `episode` stay NULL for a movie. `video`, `audio`, `size`, `mtime` and
    // `probed_at` are filled later by ffprobe (a row without `probed_at` is still to probe).
    name: 'server:012-library-items',
    sql: `
      CREATE TABLE library_items (
        library_id TEXT NOT NULL,
        path TEXT NOT NULL,
        kind TEXT,
        tmdb_id INTEGER,
        title TEXT,
        year INTEGER,
        state TEXT NOT NULL,
        nfo INTEGER,
        poster INTEGER,
        fanart INTEGER,
        season INTEGER,
        episode INTEGER,
        entry_id TEXT,
        scan_job_id TEXT,
        scanned_at TEXT NOT NULL,
        video TEXT,
        audio TEXT,
        size INTEGER,
        mtime INTEGER,
        probed_at TEXT,
        PRIMARY KEY (library_id, path)
      );
      CREATE INDEX library_items_state ON library_items (library_id, state);
    `,
  },
  {
    // Where an arrival goes when the user picked a library for it: NULL is
    // the default destination of the job. It belongs to the file, not to the job, whose settings
    // stay what the analysis used.
    name: 'server:013-entry-destination',
    sql: 'ALTER TABLE job_entries ADD COLUMN destination_library_id TEXT;',
  },
  {
    // A file holding several episodes (S01E01E02) is one row: `episode` is its first, `episode_end`
    // its last (NULL for a single one). `series_completeness` remembers how many aired episodes a
    // show of a library lacks, so the list and its filter need no TMDB call: `signature` says which
    // episodes were present when it was counted, a different one means the count is stale.
    // Disposable: a missing row only means "not counted yet".
    name: 'server:014-series-completeness',
    sql: `
      ALTER TABLE library_items ADD COLUMN episode_end INTEGER;
      CREATE TABLE series_completeness (
        library_id TEXT NOT NULL,
        tmdb_id INTEGER NOT NULL,
        missing INTEGER NOT NULL,
        signature TEXT NOT NULL,
        computed_at TEXT NOT NULL,
        PRIMARY KEY (library_id, tmdb_id)
      );
    `,
  },
  {
    // Which files of a show (`tvshow.nfo`, poster, fanart) and of a season (poster) are on the disk,
    // looked at after a scan or a change. `season` is -1 for the show's own files; NULL means the
    // profile writes no such file. Disposable: a missing row means "not looked at yet".
    name: 'server:015-series-files',
    sql: `
      CREATE TABLE series_files (
        library_id TEXT NOT NULL,
        tmdb_id INTEGER NOT NULL,
        season INTEGER NOT NULL,
        nfo INTEGER,
        poster INTEGER,
        fanart INTEGER,
        PRIMARY KEY (library_id, tmdb_id, season)
      );
    `,
  },
  {
    // A series' files are validated as a release (the folder they came in): `release` is its path,
    // `detached` marks an episode set aside because its title is not the one most of the folder
    // carries. Aliases are gone: one choice for a whole release replaces them.
    name: 'server:016-releases',
    sql: `
      ALTER TABLE job_entries ADD COLUMN release TEXT;
      ALTER TABLE job_entries ADD COLUMN detached INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX job_entries_release ON job_entries (job_id, release);
      DROP TABLE title_aliases;
    `,
  },
  {
    // A folder may hold several series: `cluster` numbers them (0 is the one most episodes name,
    // the others were `detached`), so a validation applies to a whole series of the release.
    name: 'server:017-release-clusters',
    sql: `
      ALTER TABLE job_entries ADD COLUMN cluster INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE job_entries DROP COLUMN detached;
    `,
  },
  {
    // "Remember for this work" is gone: a destination is the folder's `into` or a choice made
    // when a file is validated, never something learned.
    name: 'server:018-drop-work-destinations',
    sql: 'DROP TABLE work_destinations;',
  },
  {
    // Lookups that read whole tables until now: the batch of an execution (the history), the rows
    // of a show (counting its missing episodes), the rows of a scan (forgetting replaced scans),
    // and the counts of a job's files by state.
    name: 'server:019-lookup-indexes',
    sql: `
      CREATE INDEX executions_batch ON executions (batch_id);
      CREATE INDEX library_items_show ON library_items (library_id, tmdb_id);
      CREATE INDEX library_items_scan ON library_items (scan_job_id);
      CREATE INDEX job_entries_state ON job_entries (job_id, classification, resolution);
    `,
  },
  {
    // The id the web uses for a row (a hash of its path), stored so that one item is found by an
    // index rather than by hashing the whole library. Rows from before carry none until the store
    // fills it in on the first lookup (SQLite has no sha1).
    name: 'server:020-item-id',
    sql: `
      ALTER TABLE library_items ADD COLUMN item_id TEXT;
      CREATE INDEX library_items_item ON library_items (library_id, item_id);
    `,
  },
  {
    // The watcher asks which paths under a folder were already submitted: a range on this index
    // instead of reading every job.
    name: 'server:021-jobs-path',
    sql: 'CREATE INDEX jobs_path ON jobs (path);',
  },
  {
    // The list of a library is ordered by title (or path for a file nobody recognized): an index on
    // that very expression lets a page read the first rows instead of sorting the whole library.
    name: 'server:022-items-order',
    sql: `CREATE INDEX library_items_order
      ON library_items (library_id, lower(COALESCE(title, path)), path);`,
  },
  {
    // A scan of one folder of a typed library (a movie, a show, a season): its rows replace those
    // under that folder only, where a scan of the whole source replaces the library's.
    name: 'server:023-job-rescan',
    sql: 'ALTER TABLE jobs ADD COLUMN rescan INTEGER NOT NULL DEFAULT 0;',
  },
  {
    // Whether the logo (`logo.png`) is there, as the poster and fanart are: 1 or 0, NULL when the
    // profile writes none or the row predates it (a rescan, or for a show the next look at the
    // disk, fills it).
    name: 'server:024-logo',
    sql: `
      ALTER TABLE library_items ADD COLUMN logo INTEGER;
      ALTER TABLE series_files ADD COLUMN logo INTEGER;
    `,
  },
  {
    // What ffprobe says beyond the codecs: the dynamic range (`dolby-vision`, `hdr10-plus`,
    // `hdr10`, `hlg`, NULL for SDR) and the languages of the audio and subtitle tracks (JSON
    // arrays). Rows already probed lack them, so they are probed again in the background.
    name: 'server:025-probe-details',
    sql: `
      ALTER TABLE library_items ADD COLUMN hdr TEXT;
      ALTER TABLE library_items ADD COLUMN audio_languages TEXT;
      ALTER TABLE library_items ADD COLUMN subtitle_languages TEXT;
      UPDATE library_items SET probed_at = NULL;
    `,
  },
  {
    // Signing in to Plex with its JWT flow: the device's id and Ed25519 key (kept for as long as it
    // signs in) and the token it was given (renewed every week). One row; a secret, so it stays
    // out of config.yaml, which people edit, share and paste.
    name: 'server:026-plex-auth',
    sql: `
      CREATE TABLE plex_auth (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        client_id TEXT NOT NULL,
        private_jwk TEXT NOT NULL,
        kid TEXT NOT NULL,
        token TEXT,
        expires_at INTEGER,
        pin_id INTEGER
      );
    `,
  },
  {
    // Whether an episode's own image (`<file>.jpg`) is there: 1 or 0, NULL when the profile writes
    // none or the row predates it (a rescan fills it). An episode TMDB has no still for plans
    // nothing, so it reads as there, like a work without a logo.
    name: 'server:027-episode-thumb',
    sql: 'ALTER TABLE library_items ADD COLUMN thumb INTEGER;',
  },
  {
    // The picture size ffprobe read (`1080p`, NULL when unknown): a list falls back to it when the
    // file's name says none. Rows already probed lack it, so they are probed again in the background.
    name: 'server:028-probe-picture',
    sql: `
      ALTER TABLE library_items ADD COLUMN picture TEXT;
      UPDATE library_items SET probed_at = NULL;
    `,
  },
  {
    // The images of a movie the profile writes and TMDB has none of (JSON list of `poster`,
    // `fanart`, `logo`, NULL for none): a list shows them as unavailable, not as present. Rows from
    // before have none until the next scan.
    name: 'server:029-unavailable-images',
    sql: 'ALTER TABLE library_items ADD COLUMN unavailable TEXT;',
  },
];

/** Opens the single SQLite file of the config directory, shared with the CLI and the cache. */
export async function openDatabase(configDir: string): Promise<Database.Database> {
  return migrated(await openConfigDatabase(configDir));
}

export function migrated(database: Database.Database): Database.Database {
  applyMigrations(database, SERVER_MIGRATIONS);
  return database;
}
