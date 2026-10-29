import type { Locale } from '@kinoshelf/i18n';
import type { ErrorBody } from './queue.js';

export type BatchStatus = 'done' | 'undone' | 'failed';
export type Mode = 'copy' | 'hardlink' | 'move';

/** What `GET /api/batches` and `GET /api/batches/:id` return, as far as the screen reads it. */
export interface BatchSummary {
  readonly id: string;
  readonly at: string;
  readonly status: BatchStatus;
  readonly operations: number;
  readonly modes: readonly Mode[];
  readonly failed: number;
  readonly origin: { readonly jobId: string; readonly path: string } | null;
  readonly error: ErrorBody | null;
}

export interface BatchItem {
  readonly source: string;
  readonly destination: string | null;
  readonly mode: Mode;
  readonly status: BatchStatus;
  readonly error: ErrorBody | null;
}

export interface BatchDetail extends BatchSummary {
  readonly items: readonly BatchItem[];
}

export interface UndoReport {
  readonly batchId: string;
  readonly dryRun: boolean;
  readonly entries: readonly {
    readonly source: string;
    readonly destination: string;
    readonly mode: Mode;
    readonly status: 'undone' | 'skipped' | 'failed';
    readonly error: ErrorBody | null;
  }[];
}

export const STATUS_CHIP: Record<BatchStatus, string> = {
  done: 'chip-ok',
  undone: 'chip-neutral',
  failed: 'chip-danger',
};

/** Only a batch that transferred something and was not reverted has anything to undo. */
export const canUndo = (batch: Pick<BatchSummary, 'status'>): boolean => batch.status === 'done';

/** The count of each outcome, for the sentence that closes an undo. */
export function tally(report: UndoReport): Record<'undone' | 'skipped' | 'failed', number> {
  const counts = { undone: 0, skipped: 0, failed: 0 };
  for (const entry of report.entries) {
    counts[entry.status]++;
  }
  return counts;
}

/** A date in the language of the UI; a value that is not a date is shown as received. */
export function formatDate(iso: string, locale: Locale): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** What was submitted, or nothing for a batch the command line made. */
export const originOf = (batch: Pick<BatchSummary, 'origin'>): string | undefined =>
  batch.origin?.path;
