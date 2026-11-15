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
  'empty-replaced': 'web.activity.task.empty-replaced',
  'send-collections': 'web.activity.task.send-collections',
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
