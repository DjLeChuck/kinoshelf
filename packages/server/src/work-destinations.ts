import type { Database } from 'better-sqlite3';

/** A work and the library the user asked to send it to ("Remember for this work"). */
export interface StoredWorkDestination {
  readonly kind: 'movie' | 'series';
  readonly tmdbId: number;
  readonly libraryId: string;
  readonly createdAt: string;
}

interface Row {
  kind: 'movie' | 'series';
  tmdb_id: number;
  library_id: string;
  created_at: string;
}

const toStored = (row: Row): StoredWorkDestination => ({
  kind: row.kind,
  tmdbId: row.tmdb_id,
  libraryId: row.library_id,
  createdAt: row.created_at,
});

/**
 * Durable: a decision, not a copy of something that can be fetched again. A
 * library that no longer exists is not cleaned up here: whoever reads a destination checks it
 * still exists, and the work then goes back to the default one.
 */
export class WorkDestinationStore {
  constructor(private readonly database: Database) {}

  find(kind: 'movie' | 'series', tmdbId: number): string | undefined {
    return this.database
      .prepare<[string, number], { library_id: string }>(
        'SELECT library_id FROM work_destinations WHERE kind = ? AND tmdb_id = ?',
      )
      .get(kind, tmdbId)?.library_id;
  }

  /** The latest choice for a work is the one that counts. */
  remember(kind: 'movie' | 'series', tmdbId: number, libraryId: string): void {
    this.database
      .prepare(
        `INSERT INTO work_destinations (kind, tmdb_id, library_id, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (kind, tmdb_id) DO UPDATE SET
           library_id = excluded.library_id, created_at = excluded.created_at`,
      )
      .run(kind, tmdbId, libraryId, new Date().toISOString());
  }

  list(): StoredWorkDestination[] {
    return this.database
      .prepare<[], Row>(
        'SELECT kind, tmdb_id, library_id, created_at FROM work_destinations ORDER BY created_at DESC, tmdb_id',
      )
      .all()
      .map(toStored);
  }

  remove(kind: 'movie' | 'series', tmdbId: number): boolean {
    return (
      this.database
        .prepare('DELETE FROM work_destinations WHERE kind = ? AND tmdb_id = ?')
        .run(kind, tmdbId).changes > 0
    );
  }
}
