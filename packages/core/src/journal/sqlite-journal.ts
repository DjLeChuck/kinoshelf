import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Database } from 'better-sqlite3';
import type { Journal, JournalEntry } from '../types/journal.js';
import type { TransferMode } from '../types/operation.js';
import { applyMigrations, CORE_MIGRATIONS } from './migrations.js';

const journalEntries = sqliteTable('journal_entries', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  id: text('id').notNull().unique(),
  batchId: text('batch_id').notNull(),
  source: text('source').notNull(),
  destination: text('destination').notNull(),
  mode: text('mode').$type<TransferMode>().notNull(),
  at: text('at').notNull(),
  createdDirectories: text('created_directories').notNull(),
  undoneAt: text('undone_at'),
});

/** Durable journal in the caller's SQLite database (the single file in `/config`). */
export class SqliteJournal implements Journal {
  private readonly db: BetterSQLite3Database;

  constructor(sqlite: Database) {
    applyMigrations(sqlite, CORE_MIGRATIONS);
    this.db = drizzle(sqlite);
  }

  record(entry: JournalEntry): void {
    this.db
      .insert(journalEntries)
      .values({ ...entry, createdDirectories: JSON.stringify(entry.createdDirectories) })
      .run();
  }

  lastBatchId(): string | null {
    const row = this.db
      .select({ batchId: journalEntries.batchId })
      .from(journalEntries)
      .where(isNull(journalEntries.undoneAt))
      .orderBy(desc(journalEntries.seq))
      .limit(1)
      .get();
    return row?.batchId ?? null;
  }

  isUndone(batchId: string): boolean {
    const row = this.db
      .select({ undoneAt: journalEntries.undoneAt })
      .from(journalEntries)
      .where(eq(journalEntries.batchId, batchId))
      .orderBy(asc(journalEntries.seq))
      .all();
    return row.length > 0 && row.every((entry) => entry.undoneAt !== null);
  }

  entriesOf(batchId: string): readonly JournalEntry[] {
    return this.db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.batchId, batchId))
      .orderBy(asc(journalEntries.seq))
      .all()
      .map((row) => ({
        id: row.id,
        batchId: row.batchId,
        source: row.source,
        destination: row.destination,
        mode: row.mode,
        at: row.at,
        createdDirectories: JSON.parse(row.createdDirectories) as string[],
      }));
  }

  markUndone(batchId: string): void {
    this.db
      .update(journalEntries)
      .set({ undoneAt: new Date().toISOString() })
      .where(and(eq(journalEntries.batchId, batchId), isNull(journalEntries.undoneAt)))
      .run();
  }
}
