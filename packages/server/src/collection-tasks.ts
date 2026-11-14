import type { SendOutcome } from './collection-screen.js';
import { failureOf, type MatchFailure } from './matches.js';

/** The latest send of a library's collection images: how far it got, what each collection came to. */
export interface SendTask {
  status: 'running' | 'done' | 'failed';
  /** Collections settled out of those to send. */
  done: number;
  total: number;
  current: string | null;
  outcomes: SendOutcome[];
  error: MatchFailure | null;
}

/**
 * The sends in flight and the last one of each library, in memory like an undo's. Reaching two
 * media servers for every collection of a library takes a while, so a request only starts it and
 * the page follows the `progress` event. One at a time per library: two would upload the same images twice.
 */
export class SendTasks {
  private readonly tasks = new Map<string, SendTask>();
  /** Background looks for collections a server lacked: no task for the page, but a send is not started beside one. */
  private readonly quietRuns = new Set<string>();

  constructor(private readonly announce: () => void) {}

  of(libraryId: string): SendTask | undefined {
    return this.tasks.get(libraryId);
  }

  isRunning(libraryId: string): boolean {
    return this.tasks.get(libraryId)?.status === 'running' || this.quietRuns.has(libraryId);
  }

  /** Runs `work` unseen by the page: the result of the owner's last send stays what the page reads. */
  quiet(libraryId: string, work: () => Promise<unknown>, failed: (error: unknown) => void): void {
    this.quietRuns.add(libraryId);
    void work()
      .catch(failed)
      .finally(() => {
        this.quietRuns.delete(libraryId);
        this.announce();
      });
  }

  start(
    libraryId: string,
    work: (
      onProgress: (done: number, total: number, current: string) => void,
    ) => Promise<SendOutcome[]>,
  ): SendTask {
    const task: SendTask = {
      status: 'running',
      done: 0,
      total: 0,
      current: null,
      outcomes: [],
      error: null,
    };
    this.tasks.set(libraryId, task);
    this.announce();
    void work((done, total, current) => {
      Object.assign(task, { done, total, current: current || null });
      this.announce();
    })
      .then((outcomes) => {
        task.outcomes = outcomes;
        task.status = 'done';
      })
      .catch((error: unknown) => {
        task.error = failureOf(error);
        task.status = 'failed';
      })
      .finally(() => {
        task.current = null;
        this.announce();
      });
    return task;
  }
}
