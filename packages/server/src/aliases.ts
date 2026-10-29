import {
  aliasKey,
  type AliasLookup,
  type AliasQuery,
  type ExternalId,
  type TitleAlias,
} from '@kinoshelf/core';
import type { Database } from 'better-sqlite3';

/** An alias as the API lists it: what the file says, and the work it was tied to. */
export interface StoredAlias {
  readonly id: number;
  readonly kind: 'movie' | 'series';
  readonly title: string;
  readonly year?: number;
  readonly work: { readonly id: ExternalId; readonly title: string; readonly year?: number };
  readonly createdAt: string;
}

interface AliasRow {
  id: number;
  kind: 'movie' | 'series';
  title: string;
  year: number | null;
  provider: string;
  work_id: number;
  work_title: string;
  work_year: number | null;
  created_at: string;
}

const COLUMNS = 'id, kind, title, year, provider, work_id, work_title, work_year, created_at';

const toAlias = (row: AliasRow): StoredAlias => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  ...(row.year !== null && { year: row.year }),
  work: {
    id: { provider: row.provider, id: row.work_id },
    title: row.work_title,
    ...(row.work_year !== null && { year: row.work_year }),
  },
  createdAt: row.created_at,
});

/**
 * Titles the user tied to a work by validating a file. Durable, unlike the TMDB cache: it is a
 * decision, not a copy of something that can be fetched again.
 */
export class AliasStore implements AliasLookup {
  constructor(private readonly database: Database) {}

  find(query: AliasQuery): ExternalId | undefined {
    const row = this.database
      .prepare<[string], Pick<AliasRow, 'provider' | 'work_id'>>(
        'SELECT provider, work_id FROM title_aliases WHERE key = ?',
      )
      .get(aliasKey(query));
    return row && { provider: row.provider, id: row.work_id };
  }

  /** Tying the same title again replaces the work: the latest choice is the one that counts. */
  remember(alias: TitleAlias, work: { title: string; year?: number }): void {
    this.database
      .prepare(
        `INSERT INTO title_aliases (key, kind, title, year, provider, work_id, work_title, work_year, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET
           provider = excluded.provider, work_id = excluded.work_id,
           work_title = excluded.work_title, work_year = excluded.work_year,
           created_at = excluded.created_at`,
      )
      .run(
        aliasKey(alias),
        alias.kind,
        alias.title,
        alias.kind === 'movie' ? (alias.year ?? null) : null,
        alias.id.provider,
        alias.id.id,
        work.title,
        work.year ?? null,
        new Date().toISOString(),
      );
  }

  list(): StoredAlias[] {
    return this.database
      .prepare<[], AliasRow>(`SELECT ${COLUMNS} FROM title_aliases ORDER BY title COLLATE NOCASE`)
      .all()
      .map(toAlias);
  }

  /** `false` when there was no such alias. */
  remove(id: number): boolean {
    return this.database.prepare('DELETE FROM title_aliases WHERE id = ?').run(id).changes > 0;
  }
}
