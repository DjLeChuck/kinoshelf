import type { Database } from '../sqlite/database.js';
import type { FileIdentity, Journal, JournalBatch, JournalEntry } from '../types/journal.js';
import type { TransferMode } from '../types/operation.js';
import { applyMigrations, CORE_MIGRATIONS } from './migrations.js';

/** A row of `journal_entries`, as SQLite gives it. */
interface EntryRow {
  id: string;
  batch_id: string;
  source: string;
  destination: string;
  // `''` for a file made or downloaded: the column predates them and stays NOT NULL.
  mode: TransferMode | '';
  kind: JournalEntry['kind'];
  at: string;
  created_directories: string;
  identity: string | null;
  backup: string | null;
}

interface BatchRow {
  batch_id: string;
  at: string;
  operations: number;
  modes: string | null;
  pending: number;
}

const BATCH_COLUMNS = `batch_id, min(at) AS at, count(*) AS operations,
  group_concat(CASE WHEN kind = 'transfer' THEN mode END, ',') AS modes,
  sum(undone_at IS NULL) AS pending`;

/** Durable journal in the caller's SQLite database (the single file in `/config`). */
export class SqliteJournal implements Journal {
  constructor(private readonly db: Database) {
    applyMigrations(db, CORE_MIGRATIONS);
  }

  record(entry: JournalEntry): void {
    this.db
      .prepare(
        `INSERT INTO journal_entries
           (id, batch_id, source, destination, mode, kind, at, created_directories, identity, backup)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.batchId,
        entry.source,
        entry.destination,
        entry.kind === 'transfer' ? entry.mode : '',
        entry.kind,
        entry.at,
        JSON.stringify(entry.createdDirectories),
        entry.identity ? JSON.stringify(entry.identity) : null,
        entry.kind === 'replaced' ? entry.backup : null,
      );
  }

  lastBatchId(): string | null {
    return (
      this.db
        .prepare<[], { batch_id: string }>(
          'SELECT batch_id FROM journal_entries WHERE undone_at IS NULL ORDER BY seq DESC LIMIT 1',
        )
        .get()?.batch_id ?? null
    );
  }

  isUndone(batchId: string): boolean {
    const rows = this.db
      .prepare<[string], { undone_at: string | null }>(
        'SELECT undone_at FROM journal_entries WHERE batch_id = ?',
      )
      .all(batchId);
    return rows.length > 0 && rows.every((entry) => entry.undone_at !== null);
  }

  entriesOf(batchId: string): readonly JournalEntry[] {
    return this.db
      .prepare<[string], EntryRow>(
        `SELECT id, batch_id, source, destination, mode, kind, at, created_directories, identity, backup
         FROM journal_entries WHERE batch_id = ? ORDER BY seq`,
      )
      .all(batchId)
      .map((row): JournalEntry => {
        const common = {
          id: row.id,
          batchId: row.batch_id,
          source: row.source,
          destination: row.destination,
          at: row.at,
          createdDirectories: JSON.parse(row.created_directories) as string[],
          ...(row.identity !== null && {
            identity: JSON.parse(row.identity) as FileIdentity,
          }),
        };
        if (row.kind === 'transfer' && row.mode !== '') {
          return { ...common, kind: 'transfer', mode: row.mode };
        }
        if (row.kind === 'replaced' && row.backup !== null) {
          return { ...common, kind: 'replaced', backup: row.backup };
        }
        return { ...common, kind: row.kind === 'downloaded' ? 'downloaded' : 'generated' };
      });
  }

  markUndone(batchId: string, entryIds?: readonly string[]): void {
    if (entryIds?.length === 0) {
      return;
    }
    this.db
      .prepare(
        `UPDATE journal_entries SET undone_at = ?
         WHERE batch_id = ? AND undone_at IS NULL${
           entryIds ? ' AND id IN (SELECT value FROM json_each(?))' : ''
         }`,
      )
      .run(new Date().toISOString(), batchId, ...(entryIds ? [JSON.stringify(entryIds)] : []));
  }

  undoneEntryIds(batchId: string): ReadonlySet<string> {
    return new Set(
      this.db
        .prepare<[string], { id: string }>(
          'SELECT id FROM journal_entries WHERE batch_id = ? AND undone_at IS NOT NULL',
        )
        .all(batchId)
        .map((row) => row.id),
    );
  }

  madeFileIdentity(path: string): FileIdentity | undefined {
    const row = this.db
      .prepare<[string], { identity: string | null }>(
        `SELECT identity FROM journal_entries
         WHERE destination = ? AND kind IN ('generated', 'downloaded', 'replaced')
           AND undone_at IS NULL
         ORDER BY seq DESC LIMIT 1`,
      )
      .get(path);
    return row?.identity ? (JSON.parse(row.identity) as FileIdentity) : undefined;
  }

  madeFileSource(path: string): string | undefined {
    return this.db
      .prepare<[string], { source: string }>(
        `SELECT source FROM journal_entries
         WHERE destination = ? AND kind IN ('downloaded', 'replaced') AND undone_at IS NULL
         ORDER BY seq DESC LIMIT 1`,
      )
      .get(path)?.source;
  }

  hasBatches(): boolean {
    return this.db.prepare('SELECT 1 FROM journal_entries LIMIT 1').get() !== undefined;
  }

  batches(limit?: number): readonly JournalBatch[] {
    return this.db
      .prepare<[number], BatchRow>(
        `SELECT ${BATCH_COLUMNS} FROM journal_entries GROUP BY batch_id
         ORDER BY min(at) DESC, max(seq) DESC LIMIT ?`,
      )
      .all(limit ?? -1)
      .map(toBatch);
  }

  countBatches(): number {
    return (
      this.db
        .prepare<[], { total: number }>(
          'SELECT count(DISTINCT batch_id) AS total FROM journal_entries',
        )
        .get()?.total ?? 0
    );
  }

  batch(batchId: string): JournalBatch | undefined {
    const row = this.db
      .prepare<[string], BatchRow>(
        `SELECT ${BATCH_COLUMNS} FROM journal_entries WHERE batch_id = ? GROUP BY batch_id`,
      )
      .get(batchId);
    return row && toBatch(row);
  }
}

function toBatch(row: BatchRow): JournalBatch {
  return {
    batchId: row.batch_id,
    at: row.at,
    operations: row.operations,
    modes: row.modes ? ([...new Set(row.modes.split(','))] as TransferMode[]) : [],
    undone: row.pending === 0,
  };
}
