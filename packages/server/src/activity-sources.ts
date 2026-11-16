import type { Config } from '@kinoshelf/core';
import type { ActivitySource, ActivityTask } from './activity.js';
import type { ExecutionStore } from './executions.js';
import type { JobStore } from './jobs.js';
import type { ProgressTracker } from './progress.js';
import type { SendTasks } from './collection-tasks.js';
import type { DatabaseTasks } from './database-tasks.js';
import type { TidyTask } from './maintenance-routes.js';
import type { MatchTracker } from './matches.js';
import type { ReplacedFiles } from './replaced-files.js';
import type { UndoTasks } from './undo-tasks.js';

const task = (
  fields: Pick<ActivityTask, 'id' | 'kind' | 'code'> & Partial<ActivityTask>,
): ActivityTask => ({
  params: {},
  status: 'running',
  done: null,
  total: null,
  current: null,
  href: null,
  error: null,
  ...fields,
});

/** A library's name, else the folder's own name: what a person calls what is being scanned. */
function nameOf(config: Config, libraryId: string | null, path: string): string {
  return (
    config.libraries?.find(({ id }) => id === libraryId)?.name ??
    (path.split(/[\\/]/).filter(Boolean).pop() || path)
  );
}

/** Analyses: only the phases that count files have a bar, the walk and the planning do not. */
export function scanSource(deps: {
  progress: ProgressTracker;
  jobs: JobStore;
  config: () => Config;
}): ActivitySource {
  const describe = (jobId: string): Pick<ActivityTask, 'params' | 'href'> | undefined => {
    const job = deps.jobs.get(jobId);
    return (
      job && {
        params: { name: nameOf(deps.config(), job.libraryId, job.path) },
        href: job.libraryId ? `/libraries/${job.libraryId}` : `/history/${job.id}`,
      }
    );
  };
  return {
    list: () =>
      deps.progress.scans().flatMap(([jobId, progress]) => {
        const about = describe(jobId);
        const counted = progress.phase === 'read' || progress.phase === 'identify';
        return about
          ? [
              task({
                id: `scan:${jobId}`,
                kind: 'scan',
                code: 'scan',
                ...about,
                params: { ...about.params, phase: progress.phase },
                ...(counted &&
                  progress.total > 0 && { done: progress.done, total: progress.total }),
                current: progress.current,
              }),
            ]
          : [];
      }),
    ended: (previous) => {
      const jobId = previous.id.slice('scan:'.length);
      const job = deps.jobs.get(jobId);
      if (job?.status !== 'done' && job?.status !== 'failed') {
        return undefined;
      }
      return {
        ...previous,
        status: job.status,
        done: null,
        total: null,
        current: null,
        // A failed scan is explained by its job in the History.
        href: job.status === 'failed' ? `/history/${job.id}` : previous.href,
        error: job.error,
      };
    },
  };
}

/** Transfers: moving, copying or linking the files of a plan. */
export function transferSource(deps: {
  progress: ProgressTracker;
  jobs: JobStore;
  executions: ExecutionStore;
}): ActivitySource {
  return {
    list: () =>
      deps.progress.runningTransfers().flatMap(([executionId, progress]) => {
        const execution = deps.executions.get(executionId);
        return execution
          ? [
              task({
                id: `transfer:${executionId}`,
                kind: 'transfer',
                code: 'transfer',
                href: `/history/${execution.batchId ?? execution.jobId}`,
                done: progress.done,
                total: progress.total,
                current: progress.current,
              }),
            ]
          : [];
      }),
    ended: (previous) => {
      const execution = deps.executions.get(previous.id.slice('transfer:'.length));
      if (execution?.status !== 'done' && execution?.status !== 'failed') {
        return undefined;
      }
      return {
        ...previous,
        status: execution.status,
        current: null,
        href: `/history/${execution.batchId ?? execution.jobId}`,
        error: execution.error,
      };
    },
  };
}

/** Undos and their checks, which the source keeps after they end for the batch's own page. */
export function undoSource(undos: UndoTasks): ActivitySource {
  return {
    list: () =>
      undos.all().map(([batchId, undo]) =>
        task({
          id: `undo:${batchId}`,
          kind: 'undo',
          code: undo.dryRun ? 'undo-check' : 'undo',
          status: undo.status,
          ...(undo.total > 0 && { done: undo.done, total: undo.total }),
          current: undo.current,
          href: `/history/${batchId}`,
          error: undo.error,
        }),
      ),
  };
}

/** A count only means something once the task knows its total (a compaction never does). */
const counted = (done: number, total: number): Pick<ActivityTask, 'done' | 'total'> =>
  total > 0 ? { done, total } : { done: null, total: null };

/** Validating an arrival: the release is planned in the background after a click. */
export function matchSource(matches: MatchTracker): ActivitySource {
  return {
    list: () =>
      matches.all().map(([entryId, state]) =>
        task({
          id: `match:${entryId}`,
          kind: 'match',
          code: 'match',
          status: state.status,
          href: '/arrivals',
          ...(state.status === 'running' && {
            ...counted(state.done, state.total),
            current: state.current,
          }),
          ...(state.status === 'failed' && { error: state.error }),
        }),
      ),
  };
}

/** Tidy-ups and their reports, one task per library. */
export function tidySource(
  tasks: ReadonlyMap<string, TidyTask>,
  config: () => Config,
): ActivitySource {
  return {
    list: () =>
      [...tasks].map(([libraryId, tidy]) =>
        task({
          id: `tidy:${libraryId}:${tidy.startedAt}`,
          kind: 'tidy',
          code: tidy.dryRun ? 'tidy-report' : 'tidy',
          params: { name: nameOf(config(), libraryId, tidy.library) },
          status: tidy.status,
          ...counted(tidy.done, tidy.total),
          current: tidy.current,
          href: '/system?tab=maintenance',
          error: tidy.error,
        }),
      ),
  };
}

/** Backup and compaction of the database, and emptying `replaced/`. */
export function maintenanceSource(deps: {
  databaseTasks: DatabaseTasks;
  replaced: ReplacedFiles;
}): ActivitySource {
  const href = '/system?tab=maintenance';
  return {
    list: () => [
      ...deps.databaseTasks.tasks().map((database) =>
        task({
          id: `database:${database.kind}:${database.startedAt}`,
          kind: 'database',
          code: database.kind,
          status: database.status,
          ...counted(database.done, database.total),
          href,
          error: database.error,
        }),
      ),
      ...(() => {
        const emptying = deps.replaced.task();
        return emptying
          ? [
              task({
                id: `replaced:${emptying.startedAt}`,
                kind: 'replaced',
                code: 'empty-replaced',
                status: emptying.status,
                ...counted(emptying.done, emptying.total),
                href,
                error: emptying.error,
              }),
            ]
          : [];
      })(),
    ],
  };
}

/** Sending the images of the collections to Plex and Jellyfin. */
export function collectionSendSource(sends: SendTasks, config: () => Config): ActivitySource {
  return {
    list: () =>
      sends.all().map(([libraryId, send]) =>
        task({
          id: `send:${libraryId}`,
          kind: 'send',
          code: send.purpose === 'adopt' ? 'adopt-collections' : 'send-collections',
          params: { name: nameOf(config(), libraryId, libraryId) },
          status: send.status,
          ...counted(send.done, send.total),
          current: send.current,
          href: `/libraries/${libraryId}?vue=collections`,
          error: send.error,
        }),
      ),
  };
}
