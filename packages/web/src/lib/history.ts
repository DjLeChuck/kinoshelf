import type { Locale } from '@kinoshelf/i18n';
import type { ErrorBody } from './arrivals.js';
import type { Library } from './libraries.js';
import { isBelow } from './paths.js';
import type { Metadata, Mode, Naming } from './settings.js';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
/** `queued`/`running`: the transfer of a batch is not over. */
export type BatchStatus = 'done' | 'undone' | 'failed' | 'queued' | 'running';
export type { Mode };

/** One line of `GET /api/history`: a batch, or a job that has none yet. */
export interface Activity {
  /** A batch id or a job id, according to `kind`. */
  readonly id: string;
  readonly kind: 'batch' | 'job';
  readonly at: string;
  readonly status: BatchStatus | JobStatus;
  readonly path: string | null;
  readonly operations: number;
  readonly failed: number;
  readonly modes: readonly Mode[];
  readonly error: ErrorBody | null;
  /** A job that finished and moved nothing: only listed when asked for. */
  readonly routine: boolean;
}

/** What `GET /api/jobs/:id` returns, as far as the history reads it. */
export interface JobDetail {
  readonly id: string;
  readonly path: string;
  readonly libraryId: string | null;
  readonly status: JobStatus;
  readonly apply: boolean;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly error: ErrorBody | null;
  readonly execution: {
    readonly status: JobStatus;
    readonly batchId: string | null;
    readonly error: ErrorBody | null;
    readonly progress?: { readonly done: number; readonly total: number } | null;
  } | null;
  readonly summary: Readonly<Record<string, number>> | null;
  readonly settings: {
    readonly profile: { readonly naming: Naming; readonly metadata: Metadata };
    readonly mode: Mode;
    readonly destinationRoot: string | { readonly movie: string; readonly series: string };
  } | null;
}

/** A batch of `GET /api/history`, and what `GET /api/batches/:id` adds, as far as the screen reads it. */
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
  readonly status: Exclude<BatchStatus, 'queued' | 'running'>;
  readonly error: ErrorBody | null;
}

/** A metadata file written beside a video: an NFO Kinoshelf generated, or an image it downloaded. */
export interface BatchExtra {
  readonly kind: 'generated' | 'downloaded' | 'replaced';
  readonly destination: string;
}

export interface BatchDetail extends BatchSummary {
  readonly items: readonly BatchItem[];
  readonly extras: readonly BatchExtra[];
}

/** How far an undo (or its check) has got, while it runs. */
export interface UndoProgress {
  readonly done: number;
  readonly total: number;
  readonly current: string | null;
  readonly dryRun: boolean;
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

export const STATUS_CHIP: Record<BatchStatus | JobStatus, string> = {
  done: 'chip-ok',
  undone: 'chip-neutral',
  failed: 'chip-danger',
  queued: 'chip-neutral',
  running: 'chip-neutral',
};

/** An analysis that is done is not a job that is: its transfer may still run. */
export const jobStatusOf = (job: Pick<JobDetail, 'status' | 'execution'>): JobStatus =>
  job.execution?.status === 'queued' || job.execution?.status === 'running'
    ? job.execution.status
    : job.status;

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

/**
 * A calendar day (an air date such as `2024-03-05`), with no time. Read as UTC and shown as UTC:
 * the value has no clock, so a local zone behind UTC would otherwise show the day before.
 */
export function formatDay(iso: string, locale: Locale): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

/** What was submitted, or nothing for a batch the command line made. */
export const originOf = (batch: Pick<BatchSummary, 'origin'>): string | undefined =>
  batch.origin?.path;

/** A UUID is no name for a person; its first block is enough to tell two jobs apart. */
export const shortId = (id: string): string => id.slice(0, 8);

/** `2 s`, `1 min 12 s`; the units read the same in both languages. */
export function formatDuration(from: string, to: string): string | undefined {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return undefined;
  }
  const seconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes === 0 ? `${seconds} s` : `${minutes} min ${seconds % 60} s`;
}

/** The files of a job's analysis, whatever their classification. */
export const analysed = (summary: JobDetail['summary']): number =>
  summary === null ? 0 : Object.values(summary).reduce((sum, count) => sum + count, 0);

/** The roots a job planned for, one per kind of work. */
export function rootsOf(root: NonNullable<JobDetail['settings']>['destinationRoot']): {
  readonly movies: string;
  readonly series: string;
} {
  return typeof root === 'string'
    ? { movies: root, series: root }
    : { movies: root.movie, series: root.series };
}

/**
 * How to send a job again. A scan of a library's whole source goes through the library's own
 * route, which refuses a second scan at once and refreshes the library's rows, and so does a folder
 * of a typed library read on its own; anything else (a release, a path sent by hand) is submitted
 * as it was. A library deleted since falls back to
 * the plain submission: its scan job only needs its path.
 */
export function resendRequest(
  job: Pick<JobDetail, 'path' | 'apply' | 'libraryId'>,
  libraries: readonly Pick<Library, 'id' | 'source' | 'type'>[],
): { readonly url: string; readonly body: Record<string, unknown> } {
  const library = libraries.find(({ id }) => id === job.libraryId);
  if (library?.source === job.path) {
    return { url: `/api/libraries/${library.id}/scan`, body: {} };
  }
  // A folder of a typed library (a movie, a show) is read again as such, not as a loose path.
  if (library?.type && isBelow(job.path, library.source)) {
    return { url: `/api/libraries/${library.id}/rescan`, body: { path: job.path } };
  }
  return { url: '/api/jobs', body: { path: job.path, apply: job.apply } };
}
