import type { MessageKey } from '@kinoshelf/i18n';
import type { BatchSummary } from './history.js';
import type { Settings } from './settings.js';

const WEEK_MS = 7 * 24 * 3600 * 1000;

/** What the queue fetch asks for: the nav shows the count, so it has to say when it is cut short. */
export const QUEUE_LIMIT = 200;

export const queueLabel = (count: number): string =>
  count >= QUEUE_LIMIT ? `${QUEUE_LIMIT}+` : String(count);

const inLastWeek = (batch: BatchSummary, now: number): boolean =>
  now - new Date(batch.at).getTime() <= WEEK_MS;

/** Batches that moved files in the last seven days. */
export const weekCount = (batches: readonly BatchSummary[], now: number): number =>
  batches.filter((batch) => batch.status === 'done' && inLastWeek(batch, now)).length;

/** The most recent failed batch of the last week, `batches` being newest first. */
export const recentFailure = (
  batches: readonly BatchSummary[],
  now: number,
): BatchSummary | undefined =>
  batches.find((batch) => batch.status === 'failed' && inLastWeek(batch, now));

export const failureCount = (batches: readonly BatchSummary[], now: number): number =>
  batches.filter((batch) => batch.status === 'failed' && inLastWeek(batch, now)).length;

/** A batch carries no title, only how many files it touched: the line says that, and how it ended. */
export function activityOf(batch: BatchSummary): { key: MessageKey; count: number } {
  const key = {
    done: 'web.home.activity.done',
    undone: 'web.home.activity.undone',
    failed: 'web.home.activity.failed',
  } as const;
  return { key: key[batch.status], count: batch.operations };
}

export type ServiceId = 'tmdb' | 'plex' | 'jellyfin' | 'watch';

/** Configured or not, as the settings say: nothing is called, so opening the home costs no request to TMDB. */
export function servicesOf(settings: Settings): { id: ServiceId; on: boolean }[] {
  return [
    { id: 'tmdb', on: settings.tmdb.configured },
    { id: 'plex', on: settings.plex !== null },
    { id: 'jellyfin', on: settings.jellyfin !== null },
    { id: 'watch', on: settings.watch !== null && settings.watch.folders.length > 0 },
  ];
}

/** Worth suggesting only while neither player is connected. */
export const suggestsServer = (settings: Settings): boolean =>
  settings.plex === null && settings.jellyfin === null;

/** What the home page needs of a job (`GET /api/jobs`, newest first). */
export interface JobSummary {
  readonly id: string;
  readonly path: string;
  readonly status: 'queued' | 'running' | 'done' | 'failed';
  /** Whether the matched files were to be transferred at once: a new submission keeps it. */
  readonly apply: boolean;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly error: {
    readonly code: string;
    readonly params?: Record<string, string | number>;
  } | null;
}

/** Analyses not over yet. */
export const activeJobs = (jobs: readonly JobSummary[]): JobSummary[] =>
  jobs.filter((job) => job.status === 'queued' || job.status === 'running');

/**
 * Failed analyses nobody can have missed, however early they failed (a wrong key, a folder that
 * is gone): a failure stays until the same path is sent again. The newer job then speaks for the
 * path, whether it is working, done or failed again. `jobs` is newest first.
 */
export function unresolvedFailures(jobs: readonly JobSummary[]): JobSummary[] {
  return jobs.filter(
    (job, index) =>
      job.status === 'failed' && !jobs.slice(0, index).some((later) => later.path === job.path),
  );
}
