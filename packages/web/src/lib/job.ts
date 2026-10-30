import type { ErrorBody, QueueEntry } from './queue.js';
import type { JobSummary } from './home.js';
import type { Mode, Settings } from './settings.js';

export type Classification = QueueEntry['classification'];

/** In the order the page lists them: what needs a look comes after what was renamed. */
export const CLASSIFICATIONS: readonly Classification[] = [
  'to-rename',
  'conflict',
  'ambiguous',
  'unrecognized',
  'compliant',
];

export interface PlanSettings {
  readonly profile: string;
  readonly mode: Mode;
  readonly destinationRoot: string | { readonly movie: string; readonly series: string };
}

export interface JobExecution {
  readonly status: 'queued' | 'running' | 'done' | 'failed';
  readonly batchId: string | null;
  readonly summary: { readonly done: number; readonly failed: number } | null;
  readonly error: ErrorBody | null;
}

/** What `GET /api/jobs/{id}` returns, as far as the page reads it. */
export interface JobDetail extends JobSummary {
  readonly startedAt: string | null;
  readonly execution: JobExecution | null;
  readonly summary: Readonly<Record<Classification, number>> | null;
  readonly settings: PlanSettings | null;
  /** The library a scan started this job from; none for a folder sent by hand. */
  readonly libraryId?: string | null;
}

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

export const total = (summary: JobDetail['summary']): number =>
  summary === null ? 0 : CLASSIFICATIONS.reduce((sum, name) => sum + summary[name], 0);

/** Where a file goes next: the batch that moved it, or the queue when it waits for someone. */
export function followUp(
  entry: Pick<QueueEntry, 'classification' | 'resolution' | 'batchId'>,
): { href: string; kind: 'batch' | 'queue' } | undefined {
  if (entry.batchId) {
    return { href: `/history/${entry.batchId}`, kind: 'batch' };
  }
  const needsAnswer =
    entry.classification === 'conflict' ||
    entry.classification === 'ambiguous' ||
    entry.classification === 'unrecognized';
  return entry.resolution === 'failed' || (entry.resolution === null && needsAnswer)
    ? { href: '/queue', kind: 'queue' }
    : undefined;
}

export interface Drift {
  readonly field: 'profile' | 'mode' | 'movies' | 'series';
  readonly now: string;
}

const rootsOf = (root: PlanSettings['destinationRoot']): { movies: string; series: string } =>
  typeof root === 'string'
    ? { movies: root, series: root }
    : { movies: root.movie, series: root.series };

/**
 * What differs between the settings a job was planned with and the ones the server has now. A
 * setting that is not configured follows a default the page cannot know, so it is not compared.
 */
export function settingsDrift(frozen: PlanSettings, current: Settings['processing']): Drift[] {
  const drift: Drift[] = [];
  if (current.profile !== null && current.profile !== frozen.profile) {
    drift.push({ field: 'profile', now: current.profile });
  }
  if (current.mode !== null && current.mode !== frozen.mode) {
    drift.push({ field: 'mode', now: current.mode });
  }
  if (current.destination !== null) {
    const was = rootsOf(frozen.destinationRoot);
    const now =
      typeof current.destination === 'string'
        ? { movies: current.destination, series: current.destination }
        : current.destination;
    for (const field of ['movies', 'series'] as const) {
      if (was[field] !== now[field]) {
        drift.push({ field, now: now[field] });
      }
    }
  }
  return drift;
}

export const destinationsOf = rootsOf;
