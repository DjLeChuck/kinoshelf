import type { TransferMode } from './operation.js';

export interface JournalEntry {
  readonly id: string;
  readonly batchId: string;
  readonly source: string;
  readonly destination: string;
  readonly mode: TransferMode;
  /** ISO 8601 timestamp. */
  readonly at: string;
}

/**
 * Journal of executed operations, the basis of undo.
 * The SQLite implementation is provided by the core; an in-memory one serves tests.
 */
export interface Journal {
  record(entry: JournalEntry): void;
  /** Id of the last batch not yet undone, `null` if none. */
  lastBatchId(): string | null;
  entriesOf(batchId: string): readonly JournalEntry[];
  markUndone(batchId: string): void;
}
