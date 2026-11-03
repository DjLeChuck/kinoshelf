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
  /** A job is stored, before anyone is told: what depends on its files is brought up to date. */
  scanned?(job: Job): Promise<void>;
  /**
   * Whether an analysis and a transfer touch the same folders, so they must not run together: a
   * scan would read a library while files move in, and replace its rows with a stale view. Absent,
   * everything is held to be overlapping and the queue runs one task at a time.
   */
  overlaps?(job: Job, execution: Execution): boolean;
  /** The queue ran dry: background work (probing files) may use the disk. */
  idle?(): void;
  jobDone?(job: Job): void;
  jobFailed?(job: Job, error: StoredError): void;
  executionDone?(job: Job, execution: Execution, outcome: ExecutionOutcome): void;
  executionFailed?(job: Job, execution: Execution, error: StoredError): void;
  /** A task started or ended: what a watching client should refetch. */
  changed?(...topics: EventTopic[]): void;
}

/** Code for a failure that is not one of the core's typed errors: a bug, not a user mistake. */
const UNEXPECTED_ERROR = 'internal.unexpected';

/**
 * Runs the queue with two lanes, one task at a time in each: analyses, and transfers. TMDB is rate
 * limited and two analyses would only race each other; two copies at once would fight over the
 * same disk. An analysis and a transfer run together only when `overlaps` says they touch
 * different folders (a scan of the films while series are moved). A transfer is served before the
 * next analysis: it is what a client waits for.
 */
export class JobRunner {
  private readonly running = new Set<Promise<void>>();
  private runningExecution: Execution | undefined;
  private runningJob: Job | undefined;
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

  /** Call after queuing a task; starts what can start, and does nothing for a lane already busy. */
  kick(): void {
    if (this.stopping) {
      return;
    }
    this.pump();
    if (this.running.size === 0) {
      this.tell(() => this.hooks.idle?.());
    }
  }

  /** A task is running or about to be. */
  get busy(): boolean {
    return this.running.size > 0;
  }

  /** Resolves once the queue is empty and nothing is running. */
  async idle(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.all([...this.running]);
    }
  }

  /** Lets the running tasks finish, starts no other. */
  async stop(): Promise<void> {
    this.stopping = true;
    await this.idle();
  }

  /** Whether a task of one lane may start beside the one running in the other. */
  private mayOverlap(job: Job, execution: Execution): boolean {
    return this.hooks.overlaps?.(job, execution) === false;
  }

  /**
   * Fills each free lane with the oldest task that fits beside the other lane. `stopping` is
   * checked before claiming, so a task is never left `running` by a shutdown.
   */
  private pump(): void {
    if (this.stopping) {
      return;
    }
    if (!this.runningExecution) {
      const execution = this.executions.claimNext((candidate) => {
        const job = this.jobs.get(candidate.jobId);
        return (
          !this.runningJob || (job !== undefined && this.mayOverlap(this.runningJob, candidate))
        );
      });
      if (execution) {
        this.runningExecution = execution;
        this.launch(this.runExecution(execution), () => {
          this.runningExecution = undefined;
        });
      }
    }
    if (!this.runningJob) {
      const job = this.jobs.claimNext(
        (candidate) => !this.runningExecution || this.mayOverlap(candidate, this.runningExecution),
      );
      if (job) {
        this.runningJob = job;
        this.launch(this.runJob(job), () => {
          this.runningJob = undefined;
        });
      }
    }
  }

  private launch(work: Promise<void>, release: () => void): void {
    const task: Promise<void> = work.finally(() => {
      this.running.delete(task);
      release();
      // What the finished task held back may start now, in either lane.
      this.pump();
      if (this.running.size === 0) {
        this.tell(() => this.hooks.idle?.());
      }
    });
    this.running.add(task);
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
      this.tell(() => this.hooks.changed?.('jobs', 'arrivals', 'history'));
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
      // A snapshot that fails to follow is a log line, not a failed scan: the files are stored.
      await Promise.resolve(this.hooks.scanned?.(job)).catch(this.onError);
      this.tell(() => this.hooks.jobDone?.(job));
      this.tell(() => this.hooks.changed?.('jobs', 'arrivals'));
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
