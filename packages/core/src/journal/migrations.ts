import type { Database } from 'better-sqlite3';

/**
 * Ordered schema changes, applied once each. Never edit an entry that has shipped: add a new
 * one. Applied names are tracked in `schema_migrations`, a table of its own, so Kinoshelf
 * modules sharing the one SQLite file do not step on each other (as `PRAGMA user_version`
 * would make them).
 */
export const CORE_MIGRATIONS: readonly { readonly name: string; readonly sql: string }[] = [
  {
    name: 'core:001-journal',
    sql: `
      CREATE TABLE journal_entries (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        batch_id TEXT NOT NULL,
        source TEXT NOT NULL,
        destination TEXT NOT NULL,
        mode TEXT NOT NULL,
        at TEXT NOT NULL,
        created_directories TEXT NOT NULL,
        undone_at TEXT
      );
      CREATE INDEX journal_entries_batch ON journal_entries (batch_id);
    `,
  },
];

export function applyMigrations(
  sqlite: Database,
  migrations: readonly { readonly name: string; readonly sql: string }[],
): void {
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)',
  );
  const applied = new Set(
    sqlite
      .prepare<[], { name: string }>('SELECT name FROM schema_migrations')
      .all()
      .map((row) => row.name),
  );
  for (const migration of migrations) {
    if (applied.has(migration.name)) {
      continue;
    }
    // One transaction per migration: a failure leaves no half-applied schema behind.
    sqlite.transaction(() => {
      sqlite.exec(migration.sql);
      sqlite
        .prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')
        .run(migration.name, new Date().toISOString());
    })();
  }
}
