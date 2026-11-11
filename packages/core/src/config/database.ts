import { join } from 'node:path';
import { Database } from '../sqlite/database.js';
import { DATABASE_FILE, ensureConfigDirectory } from './config.js';

/** How long a writer waits for the other process (CLI or server) before SQLITE_BUSY. */
const BUSY_TIMEOUT_MS = 5000;

/**
 * Opens the single SQLite file of the config directory, shared by the CLI, the server and the
 * TMDB cache. WAL lets readers go on while one process writes, and `synchronous = NORMAL` syncs
 * at checkpoints instead of on every commit: a scan of a large library makes tens of thousands
 * of small transactions, each a disk flush otherwise. In WAL mode NORMAL never corrupts the
 * file; a power cut may only lose the last commits.
 */
export async function openConfigDatabase(configDir: string): Promise<Database> {
  await ensureConfigDirectory(configDir);
  return tuned(new Database(join(configDir, DATABASE_FILE)));
}

function tuned(database: Database): Database {
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = NORMAL');
  database.pragma(`busy_timeout = ${String(BUSY_TIMEOUT_MS)}`);
  return database;
}
