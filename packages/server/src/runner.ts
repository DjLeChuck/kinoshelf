import { KinoshelfError } from '@kinoshelf/core';
import type { StoredError } from './entries.js';
import { ApiError } from './api-error.js';
import type { Execution, ExecutionStore, ExecutionSummary } from './executions.js';
import type { Job, JobStore, ProcessedJob } from './jobs.js';

export type JobProcessor = (job: Job) => Promise<ProcessedJob>;
/** Transfers the files of an execution. */
export type ExecutionRunner = (execution: Execution) => Promise<ExecutionSummary>;

/** Code for a failure that is not one of the core's typed errors: a bug, not a user mistake. */
export const UNEXPECTED_ERROR = 'internal.unexpected';

/**
 * Runs the queue one task at a time: analyses and transfers alike. TMDB is rate limited, two
 * analyses of the same folder would only race each other, and two copies at once would fight over
 * the same disk. A transfer is served before the next analysis: it is what a client waits for.
 */
export class JobRunner {
  private loop: Promise<void> | undefined;
  private stopping = false;

  constructor(
    private readonly jobs: JobStore,
    private readonly executions: ExecutionStore,
    private readonly process: JobProcessor,
    private readonly execute: ExecutionRunner,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  /** Picks up what a previous run left behind. */
  start(): void {
    this.jobs.requeueRunning();
    this.executions.requeueRunning();
    this.kick();
  }

  /** Call after queuing a task; a no-op while the loop is already draining the queue. */
  kick(): void {
    if (this.loop || this.stopping) {
      return;
    }
    this.loop = this.drain().finally(() => {
      this.loop = undefined;
    });
  }

  /** A task is running or about to be. */
  get busy(): boolean {
    return this.loop !== undefined;
  }

  /** Resolves once the queue is empty and nothing is running. */
  async idle(): Promise<void> {
    while (this.loop) {
      await this.loop;
    }
  }

  /** Lets the running task finish, starts no other. */
  async stop(): Promise<void> {
    this.stopping = true;
    await this.idle();
  }

  private async drain(): Promise<void> {
    // `stopping` is checked before claiming, so a task is never left `running` by a shutdown.
    while (!this.stopping) {
      const execution = this.executions.claimNext();
      if (execution) {
        await this.runExecution(execution);
        continue;
      }
      const job = this.jobs.claimNext();
      if (!job) {
        return;
      }
      await this.runJob(job);
    }
  }

  private async runExecution(execution: Execution): Promise<void> {
    try {
      this.executions.complete(execution.id, await this.execute(execution));
    } catch (error) {
      this.executions.fail(execution.id, this.describe(error));
    }
  }

  private async runJob(job: Job): Promise<void> {
    try {
      this.jobs.complete(job, await this.process(job));
    } catch (error) {
      this.jobs.fail(job.id, this.describe(error));
    }
  }

  private describe(error: unknown): StoredError {
    if (error instanceof KinoshelfError) {
      return error.info;
    }
    if (error instanceof ApiError) {
      return { code: error.code, ...(error.params && { params: error.params }) };
    }
    this.onError(error);
    return {
      code: UNEXPECTED_ERROR,
      params: { message: error instanceof Error ? error.message : String(error) },
    };
  }
}
