import { KinoshelfError } from '@kinoshelf/core';
import type { StoredError } from './entries.js';
import { ApiError } from './api-error.js';
import type { Job, JobStore, ProcessedJob } from './jobs.js';

export type JobProcessor = (job: Job) => Promise<ProcessedJob>;
/** Transfers a finished job's matched files and returns the batch they went in. */
export type JobApplier = (job: Job) => Promise<string>;

/** Code for a failure that is not one of the core's typed errors: a bug, not a user mistake. */
export const UNEXPECTED_ERROR = 'internal.unexpected';

/**
 * Runs queued jobs one at a time: TMDB is rate limited, and two analyses of the same folder
 * would only race each other.
 */
export class JobRunner {
  private loop: Promise<void> | undefined;
  private stopping = false;

  constructor(
    private readonly store: JobStore,
    private readonly process: JobProcessor,
    private readonly apply: JobApplier,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  /** Picks up what a previous run left behind. */
  start(): void {
    this.store.requeueRunning();
    this.kick();
  }

  /** Call after queuing a job; a no-op while the loop is already draining the queue. */
  kick(): void {
    if (this.loop || this.stopping) {
      return;
    }
    this.loop = this.drain().finally(() => {
      this.loop = undefined;
    });
  }

  /** Resolves once the queue is empty and nothing is running. */
  async idle(): Promise<void> {
    while (this.loop) {
      await this.loop;
    }
  }

  /** Lets the running job finish, starts no other. */
  async stop(): Promise<void> {
    this.stopping = true;
    await this.idle();
  }

  private async drain(): Promise<void> {
    // `stopping` is checked before claiming, so a job is never left `running` by a shutdown.
    while (!this.stopping) {
      const job = this.store.claimNext();
      if (!job) {
        return;
      }
      try {
        this.store.complete(job.id, await this.process(job));
        if (job.apply) {
          this.store.setBatch(job.id, await this.apply(job));
        }
      } catch (error) {
        this.store.fail(job.id, this.describe(error));
      }
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
