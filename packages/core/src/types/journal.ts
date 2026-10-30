import type { TransferMode } from './operation.js';

/** Fields every journaled operation has, whatever it did. */
interface JournalEntryBase {
  readonly id: string;
  readonly batchId: string;
  /** The file's origin: a path for a transfer, the URL for a download, `''` for generated content. */
  readonly source: string;
  readonly destination: string;
  /**
   * Directories this operation had to create, outermost first. Undo removes them (if empty)
   * and nothing else, so it can never prune a directory the user already had.
   */
  readonly createdDirectories: readonly string[];
  /** ISO 8601 timestamp. */
  readonly at: string;
}

/** A video or sidecar moved, copied or linked. */
export interface TransferJournalEntry extends JournalEntryBase {
  readonly kind: 'transfer';
  readonly mode: TransferMode;
}

/**
 * A file Kinoshelf made (NFO, `generated`) or fetched (artwork, `downloaded`). Undo deletes it,
 * since it is ours and has no original to put back; it has no transfer mode.
 */
export interface CreatedJournalEntry extends JournalEntryBase {
  readonly kind: 'generated' | 'downloaded';
  readonly mode?: undefined;
}

export type JournalEntry = TransferJournalEntry | CreatedJournalEntry;

/** What a list of batches shows; `entriesOf` gives the operations. */
export interface JournalBatch {
  readonly batchId: string;
  /** When its first operation was recorded (ISO 8601). */
  readonly at: string;
  /** Every recorded operation, generated and downloaded files included. */
  readonly operations: number;
  /** The transfer modes used (files made or downloaded have none), in the order they first appear. */
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
