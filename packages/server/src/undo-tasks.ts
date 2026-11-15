import { failureOf, type MatchFailure } from './matches.js';
import type { UndoReport } from './service.js';

/** The latest undo (or check) of a batch: how far it has got while it runs, its report once it ends. */
export interface UndoTask {
  status: 'running' | 'done' | 'failed';
  /** A check reads the disk but changes nothing. */
  dryRun: boolean;
  /** Entries settled out of those to revert. */
  done: number;
  total: number;
  /** The last file settled (where it was). */
  current: string | null;
  report: UndoReport | null;
  error: MatchFailure | null;
}

/** How many finished tasks are remembered: the page reads one right after it ends. */
const KEPT = 20;

/**
 * The undos in flight and the last one of each batch, in the memory of the server. Reverting a big
 * batch on a share takes minutes, so a request only starts it: the page follows the `progress`
 * event and reads the report here. One task at a time per batch, a check included: a check running
 * beside a real undo would describe files that are moving, and two real ones would revert the same
 * files twice.
 */
export class UndoTasks {
  private readonly tasks = new Map<string, UndoTask>();

  constructor(
    /** Tells the clients something moved (the `progress` topic, with no payload). */
    private readonly announce: () => void,
  ) {}

  of(batchId: string): UndoTask | undefined {
    return this.tasks.get(batchId);
  }

  /** The latest task of every batch, by batch id. */
  all(): [string, UndoTask][] {
    return [...this.tasks];
  }

  /** An undo of any batch is running: what it is about to restore must not be deleted. */
  anyRunning(): boolean {
    return [...this.tasks.values()].some(({ status }) => status === 'running');
  }

  isRunning(batchId: string): boolean {
    return this.tasks.get(batchId)?.status === 'running';
  }

  /** Starts `work` and answers at once; `ended` is told when it is over, whatever became of it. */
  start(
    batchId: string,
    dryRun: boolean,
    work: (
      onProgress: (done: number, total: number, current: string) => void,
    ) => Promise<UndoReport>,
    ended: (task: UndoTask) => void,
  ): UndoTask {
    const task: UndoTask = {
      status: 'running',
      dryRun,
      done: 0,
      total: 0,
      current: null,
      report: null,
      error: null,
    };
    this.tasks.delete(batchId);
    this.tasks.set(batchId, task);
    this.forget();
    this.announce();
    void work((done, total, current) => {
      Object.assign(task, { done, total, current: current || null });
      this.announce();
    })
      .then((report) => {
        task.report = report;
        task.status = 'done';
      })
      .catch((error: unknown) => {
        task.error = failureOf(error);
        task.status = 'failed';
      })
      .finally(() => {
        task.current = null;
        this.announce();
        ended(task);
      });
    return task;
  }

  private forget(): void {
    const finished = [...this.tasks].filter(([, task]) => task.status !== 'running');
    for (const [batchId] of finished.slice(0, Math.max(0, finished.length - KEPT))) {
      this.tasks.delete(batchId);
    }
  }
}
