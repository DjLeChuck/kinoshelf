import type { TransferMode } from './operation.js';

/**
 * A file as Kinoshelf left it. Size and modification date only: device and inode numbers change
 * when a share is mounted again (NFS, SMB without server inodes), which would make every file
 * look replaced after a reboot.
 */
export interface FileIdentity {
  readonly size: number;
  readonly mtimeMs: number;
}

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
  /**
   * The destination right after it was written. Undo leaves a file that differs since (the user
   * replaced the poster, edited the NFO): it is no longer what Kinoshelf made. Absent from entries
   * journaled before it existed, which undo trusts as before.
   */
  readonly identity?: FileIdentity;
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
  /**
   * Marks the batch undone, or only `entryIds` of it: what an undo that did not finish already
   * reverted, which a retry must leave alone (a later batch may have put a file there again).
   */
  markUndone(batchId: string, entryIds?: readonly string[]): void;
  /** Ids of the entries of the batch already reverted. */
  undoneEntryIds(batchId: string): ReadonlySet<string>;
  /** Whether anything was ever journaled, without summing up the batches. */
  hasBatches(): boolean;
  /** Every batch, the most recent first. */
  batches(): readonly JournalBatch[];
  /** One batch, without summing up the others; `undefined` for an unknown id. */
  batch(batchId: string): JournalBatch | undefined;
}
