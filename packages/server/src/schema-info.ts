import type { Database } from '@kinoshelf/core';

export interface MigrationState {
  /** Migrations applied to this database, the core's and the server's together. */
  readonly applied: number;
  /** The one applied last: its name and when, `null` on a database that has none. */
  readonly last: { readonly name: string; readonly appliedAt: string } | null;
}

/**
 * Reads `schema_migrations` as it is, so the Health card is right whoever added the migration
 * and no list has to be kept in step with the ones that ship.
 */
export function migrationState(database: Database): MigrationState {
  const applied =
    database.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM schema_migrations').get()?.n ??
    0;
  // Rows come in the order they were applied (an INTEGER rowid), which a name or a date may not.
  const last = database
    .prepare<[], { name: string; applied_at: string }>(
      'SELECT name, applied_at FROM schema_migrations ORDER BY rowid DESC LIMIT 1',
    )
    .get();
  return { applied, last: last ? { name: last.name, appliedAt: last.applied_at } : null };
}
