import { KinoshelfError } from '@kinoshelf/core';
import type { StoredError } from './entries.js';
import { ApiError } from './api-error.js';
import type { Execution, ExecutionStore } from './executions.js';
import type { Job, JobStore, ProcessedJob } from './jobs.js';
import type { EventTopic } from './events.js';
import type { ExecutionOutcome } from './notify/message.js';

export type JobProcessor = (job: Job) => Promise<ProcessedJob>;
/** Transfers the files of an execution. */
export type ExecutionRunner = (execution: Execution) => Promise<ExecutionOutcome>;

/** What the runner tells, once something ended: who to notify is the caller's business. */
export interface RunnerHooks {
  jobDone?(job: Job): void;
  jobFailed?(job: Job, error: StoredError): void;
  executionDone?(job: Job, execution: Execution, outcome: ExecutionOutcome): void;
  executionFailed?(job: Job, execution: Execution, error: StoredError): void;
  /** A task started or ended: what a watching client should refetch. */
  changed?(...topics: EventTopic[]): void;
}

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
    private readonly hooks: RunnerHooks = {},
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
    const job = this.jobs.get(execution.jobId);
    this.tell(() => this.hooks.changed?.('jobs'));
    try {
      const outcome = await this.execute(execution);
      this.executions.complete(
        execution.id,
        outcome.summary,
        outcome.files.flatMap((file) =>
          file.status === 'failed' && file.error
            ? [
                {
                  path: file.path,
                  destination: file.destination,
                  error: {
                    code: file.error.code,
                    ...(file.error.params && { params: file.error.params }),
                  },
                },
              ]
            : [],
        ),
      );
      this.tell(() => {
        const finished = this.executions.get(execution.id);
        if (job && finished) {
          this.hooks.executionDone?.(job, finished, outcome);
        }
      });
      this.tell(() => this.hooks.changed?.('jobs', 'queue', 'history'));
    } catch (error) {
      const info = this.describe(error);
      this.executions.fail(execution.id, info);
      this.tell(() => {
        if (job) {
          this.hooks.executionFailed?.(job, this.executions.get(execution.id) ?? execution, info);
        }
      });
      this.tell(() => this.hooks.changed?.('jobs', 'history'));
    }
  }

  private async runJob(job: Job): Promise<void> {
    this.tell(() => this.hooks.changed?.('jobs'));
    try {
      this.jobs.complete(job, await this.process(job));
      this.tell(() => this.hooks.jobDone?.(job));
      this.tell(() => this.hooks.changed?.('jobs', 'queue'));
    } catch (error) {
      const info = this.describe(error);
      this.jobs.fail(job.id, info);
      this.tell(() => this.hooks.jobFailed?.(job, info));
      this.tell(() => this.hooks.changed?.('jobs'));
    }
  }

  /** A hook that fails must not fail the task it reports on. */
  private tell(hook: () => void): void {
    try {
      hook();
    } catch (error) {
      this.onError(error);
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
