import { basename } from 'node:path';
import { describeError, type Translate } from '@kinoshelf/i18n';
import type { ExecutionSummary } from '../executions.js';
import type { Job } from '../jobs.js';

export type NotificationEvent = 'transferred' | 'failed' | 'needs-review';

export interface ErrorBody {
  readonly code: string;
  readonly params?: Readonly<Record<string, string | number>> | undefined;
}

/** A file of a finished transfer, with what is needed to tell the media servers where to look. */
export interface OutcomeFile {
  readonly path: string;
  readonly destination: string | null;
  readonly kind: 'movie' | 'series';
  readonly status: 'done' | 'failed';
  readonly error?: ErrorBody | undefined;
}

export interface ExecutionOutcome {
  readonly summary: ExecutionSummary;
  readonly files: readonly OutcomeFile[];
}

export interface Notification {
  /** `test` is only sent by `POST /api/notifications/test`. */
  readonly event: NotificationEvent | 'test';
  /** For a failure: what failed. */
  readonly reason?: 'job' | 'execution' | 'files';
  /** Translated, for people. Machines read the codes below. */
  readonly title: string;
  readonly message: string;
  readonly at: string;
  readonly job?: { readonly id: string; readonly path: string };
  readonly execution?: {
    readonly id: string;
    readonly batchId: string | null;
    readonly done: number;
    readonly failed: number;
  };
  readonly files?: readonly {
    readonly path: string;
    readonly destination: string | null;
    readonly status: 'done' | 'failed';
    readonly error?: ErrorBody;
  }[];
  /** There were more files than `files` lists. */
  readonly truncated?: boolean;
  readonly error?: ErrorBody;
  readonly review?: {
    readonly ambiguous: number;
    readonly unrecognized: number;
    readonly conflict: number;
  };
}

/** A transfer of thousands of files must not make a message of thousands of lines. */
const MAX_FILES = 50;
/** Failed files named in the text, for the people who read it. */
const MAX_FILES_IN_TEXT = 5;

const jobRef = (job: Job): { id: string; path: string } => ({ id: job.id, path: job.path });

const withoutUndefined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

function listed(files: readonly OutcomeFile[]): Pick<Notification, 'files' | 'truncated'> {
  return {
    files: files.slice(0, MAX_FILES).map((file) =>
      withoutUndefined({
        path: file.path,
        destination: file.destination,
        status: file.status,
        error: file.error && withoutUndefined({ ...file.error }),
      }),
    ) as NonNullable<Notification['files']>,
    ...(files.length > MAX_FILES && { truncated: true }),
  };
}

export function transferredNotification(
  t: Translate,
  job: Job,
  execution: { id: string; batchId: string | null },
  outcome: ExecutionOutcome,
  at: Date,
): Notification {
  const { done, failed } = outcome.summary;
  const base = {
    at: at.toISOString(),
    job: jobRef(job),
    execution: { id: execution.id, batchId: execution.batchId, done, failed },
    ...listed(outcome.files),
  };
  if (failed === 0) {
    return {
      event: 'transferred',
      title: t('notify.transferred.title', { count: done }),
      message: t('notify.transferred.message', { count: done, path: job.path }),
      ...base,
    };
  }
  const lines = outcome.files
    .filter((file) => file.status === 'failed')
    .slice(0, MAX_FILES_IN_TEXT)
    .map(
      (file) =>
        `- ${t('notify.failed.file', {
          name: basename(file.path),
          reason: describeError(t, file.error ?? { code: 'unknown' }),
        })}`,
    );
  return {
    event: 'failed',
    reason: 'files',
    title: t('notify.failed.files.title', { failed }),
    message: [t('notify.failed.files.message', { done, failed, path: job.path }), ...lines].join(
      '\n',
    ),
    ...base,
  };
}

export function jobFailedNotification(
  t: Translate,
  job: Job,
  error: ErrorBody,
  at: Date,
): Notification {
  return {
    event: 'failed',
    reason: 'job',
    title: t('notify.failed.job.title'),
    message: t('notify.failed.job.message', { path: job.path, reason: describeError(t, error) }),
    at: at.toISOString(),
    job: jobRef(job),
    error: withoutUndefined({ ...error }),
  };
}

export function executionFailedNotification(
  t: Translate,
  job: Job,
  execution: { id: string; batchId: string | null },
  error: ErrorBody,
  at: Date,
): Notification {
  return {
    event: 'failed',
    reason: 'execution',
    title: t('notify.failed.execution.title'),
    message: t('notify.failed.execution.message', {
      path: job.path,
      reason: describeError(t, error),
    }),
    at: at.toISOString(),
    job: jobRef(job),
    execution: { id: execution.id, batchId: execution.batchId, done: 0, failed: 0 },
    error: withoutUndefined({ ...error }),
  };
}

export function reviewNotification(
  t: Translate,
  job: Job,
  counts: { ambiguous: number; unrecognized: number; conflict: number },
  at: Date,
): Notification {
  const count = counts.ambiguous + counts.unrecognized + counts.conflict;
  return {
    event: 'needs-review',
    title: t('notify.review.title', { count }),
    message: t('notify.review.message', { count, path: job.path, ...counts }),
    at: at.toISOString(),
    job: jobRef(job),
    review: counts,
  };
}

export function testNotification(t: Translate, at: Date): Notification {
  return {
    event: 'test',
    title: t('notify.test.title'),
    message: t('notify.test.message'),
    at: at.toISOString(),
  };
}
