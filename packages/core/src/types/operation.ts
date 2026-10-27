import type { ErrorInfo } from './errors.js';

export type TransferMode = 'copy' | 'hardlink' | 'move';

/** A file is either the main file or a sidecar (`.srt`, existing `.nfo`) that follows it. */
export type FileRole = 'main' | 'sidecar';

export interface TransferOperation {
  readonly type: 'transfer';
  readonly mode: TransferMode;
  readonly role: FileRole;
  readonly source: string;
  readonly destination: string;
}

/** Writes generated content (NFO). */
export interface WriteFileOperation {
  readonly type: 'write-file';
  readonly destination: string;
  readonly content: string;
}

/** Downloads an image (artwork). */
export interface DownloadOperation {
  readonly type: 'download';
  readonly url: string;
  readonly destination: string;
}

/** A disk operation. Nothing runs without a validated plan. */
export type Operation = TransferOperation | WriteFileOperation | DownloadOperation;

export type OperationStatus = 'done' | 'failed' | 'skipped';

export interface OperationResult {
  readonly operation: Operation;
  readonly status: OperationStatus;
  /** Stable code and parameters when `status` is `failed` or `skipped` (translated at the edges). */
  readonly error?: ErrorInfo;
}
