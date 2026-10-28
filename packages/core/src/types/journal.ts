import type { TransferMode } from './operation.js';

export interface JournalEntry {
  readonly id: string;
  readonly batchId: string;
  readonly source: string;
  readonly destination: string;
  readonly mode: TransferMode;
  /**
   * Directories this operation had to create, outermost first. Undo removes them (if empty)
   * and nothing else, so it can never prune a directory the user already had.
   */
  readonly createdDirectories: readonly string[];
  /** ISO 8601 timestamp. */
  readonly at: string;
}

/** What a list of batches shows; `entriesOf` gives the operations. */
export interface JournalBatch {
  readonly batchId: string;
  /** When its first operation was recorded (ISO 8601). */
  readonly at: string;
  readonly operations: number;
  /** The modes used, in the order they first appear. */
  readonly modes: readonly TransferMode[];
  /** Every operation was undone. */
  readonly undone: boolean;
}

/**
 * Journal of executed operations, the basis of undo.
 * The SQLite implementation is provided by the core; an in-memory one serves tests.
 */
export interface Journal {
  record(entry: JournalEntry): void;
  /** Id of the last batch not yet undone, `null` if none. */
  lastBatchId(): string | null;
  /** True once a batch was undone; false for a batch still pending and for an unknown one. */
  isUndone(batchId: string): boolean;
  entriesOf(batchId: string): readonly JournalEntry[];
  markUndone(batchId: string): void;
  /** Every batch, the most recent first. */
  batches(): readonly JournalBatch[];
}
