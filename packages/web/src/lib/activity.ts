import type { MessageKey } from '@kinoshelf/i18n';
import type { paths } from './api-schema.js';

export type ActivityTask =
  paths['/api/activity']['get']['responses'][200]['content']['application/json']['tasks'][number];

const LABELS: Readonly<Record<string, MessageKey>> = {
  scan: 'web.activity.task.scan',
  match: 'web.activity.task.match',
  tidy: 'web.activity.task.tidy',
  'tidy-report': 'web.activity.task.tidy-report',
  backup: 'web.activity.task.backup',
  vacuum: 'web.activity.task.vacuum',
  'imdb-ratings': 'web.activity.task.imdb-ratings',
  'imdb-nfo': 'web.activity.task.imdb-nfo',
  'empty-replaced': 'web.activity.task.empty-replaced',
  'send-collections': 'web.activity.task.send-collections',
  'adopt-collections': 'web.activity.task.adopt-collections',
  transfer: 'web.activity.task.transfer',
  undo: 'web.activity.task.undo',
  'undo-check': 'web.activity.task.undo-check',
};

/** The title of a task; a code this version does not know (a newer server) still reads. */
export const labelOf = (task: Pick<ActivityTask, 'code'>): MessageKey =>
  LABELS[task.code] ?? 'web.activity.task.unknown';

const PHASES: Readonly<Record<string, MessageKey>> = {
  discover: 'web.library.progress.discover',
  read: 'web.library.progress.read',
  identify: 'web.library.progress.identify',
  plan: 'web.library.progress.plan',
};

/** What a running scan is doing, when the task says. */
export const phaseOf = (task: Pick<ActivityTask, 'params'>): MessageKey | undefined =>
  PHASES[String(task.params.phase ?? '')];

/** `undefined` when the task cannot tell how far it is: the bar is then indeterminate. */
export function percentOf(task: Pick<ActivityTask, 'done' | 'total'>): number | undefined {
  return task.done !== null && task.total !== null && task.total > 0
    ? Math.min(100, Math.floor((task.done / task.total) * 100))
    : undefined;
}

/** The job a running scan task stands for, when it is one (its id is `scan:<job id>`). */
export const cancellableJob = (
  task: Pick<ActivityTask, 'id' | 'kind' | 'status'>,
): string | undefined =>
  task.kind === 'scan' && task.status === 'running' ? task.id.slice('scan:'.length) : undefined;

export const isRunning = (task: Pick<ActivityTask, 'status'>): boolean => task.status === 'running';

/** The pill's bar: the mean of the running tasks that count, undefined when none does. */
export function overallPercent(tasks: readonly ActivityTask[]): number | undefined {
  const known = tasks.filter(isRunning).flatMap((task) => percentOf(task) ?? []);
  return known.length === 0
    ? undefined
    : Math.floor(known.reduce((sum, value) => sum + value, 0) / known.length);
}

/** Running first, then failures (they need a look), then what is done; stable inside each. */
export function ordered(tasks: readonly ActivityTask[]): ActivityTask[] {
  const rank = (task: ActivityTask): number =>
    task.status === 'running' ? 0 : task.status === 'failed' ? 1 : 2;
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => rank(a.task) - rank(b.task) || a.index - b.index)
    .map(({ task }) => task);
}

/** A line of the panel: a task, or the scans of one place folded together. */
export interface ActivityRow {
  readonly task: ActivityTask;
  /** Every task the line stands for, so that closing it closes them all. */
  readonly ids: readonly string[];
  readonly count: number;
}

/**
 * A watched folder queues one scan per release, so a hundred arrivals would be a hundred lines.
 * The scans of one place that went well make one line (the one running, else the latest); a failed
 * one stays apart, since each has its own cause. Display only: the server still lists every task.
 */
export function grouped(tasks: readonly ActivityTask[]): ActivityRow[] {
  const rows: { task: ActivityTask; ids: string[] }[] = [];
  const byPlace = new Map<string, { task: ActivityTask; ids: string[] }>();
  for (const task of tasks) {
    if (task.kind !== 'scan' || task.status === 'failed') {
      rows.push({ task, ids: [task.id] });
      continue;
    }
    const place = `${String(task.params.name)}|${task.href ?? ''}`;
    const row = byPlace.get(place);
    if (row === undefined) {
      const created = { task, ids: [task.id] };
      byPlace.set(place, created);
      rows.push(created);
    } else {
      row.ids.push(task.id);
      // `ordered` puts the running ones first, so the line keeps showing what is going on.
      if (task.status === 'running' && row.task.status !== 'running') {
        row.task = task;
      }
    }
  }
  return rows.map(({ task, ids }) => ({ task, ids, count: ids.length }));
}
