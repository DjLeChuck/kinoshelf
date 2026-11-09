import type { Journal, JournalBatch, TransferMode } from '@kinoshelf/core';
import type { StoredError } from './entries.js';
import type { Execution, ExecutionStore } from './executions.js';
import type { Job, JobStatus, JobStore } from './jobs.js';

/**
 * `done`: something was transferred; `undone`: it was reverted; `failed`: the execution moved
 * nothing (a hardlink across file systems, a destination that exists), so the journal has no
 * trace of it and there is nothing to undo.
 */
export type BatchStatus = 'done' | 'undone' | 'failed';

export interface BatchOrigin {
  readonly jobId: string;
  /** What was submitted, as given to `POST /api/jobs`. */
  readonly path: string;
}

export interface BatchSummary {
  readonly id: string;
  readonly at: string;
  /** `queued`/`running` while its transfer is not over: the journal already holds what went through. */
  readonly status: BatchStatus | 'queued' | 'running';
  readonly operations: number;
  readonly modes: readonly TransferMode[];
  /** Files that did not go through in a batch that did transfer others. */
  readonly failed: number;
  /** `null` for a batch made by the CLI, which shares the journal but not the job queue. */
  readonly origin: BatchOrigin | null;
  /** The error shared by the failed files, when the whole batch failed. */
  readonly error: StoredError | null;
}

export interface BatchOperation {
  readonly source: string;
  readonly destination: string | null;
  readonly mode: TransferMode;
  readonly status: 'done' | 'undone' | 'failed';
  readonly error: StoredError | null;
}

export interface BatchExtra {
  /** `generated` is an NFO written by Kinoshelf, `downloaded` an image, `replaced` an image chosen by the user over another. */
  readonly kind: 'generated' | 'downloaded' | 'replaced';
  readonly destination: string;
}

export interface BatchDetail extends BatchSummary {
  readonly items: readonly BatchOperation[];
  readonly extras: readonly BatchExtra[];
}

/** One line of the history: a batch, or a job that has none (one that is still waiting or that failed). */
export interface Activity {
  /** The batch id for a batch, the job id for a job: the two never collide (UUIDs). */
  readonly id: string;
  readonly kind: 'batch' | 'job';
  readonly at: string;
  readonly status: BatchStatus | JobStatus;
  /** What was submitted; `null` for a batch made by the CLI. */
  readonly path: string | null;
  readonly operations: number;
  readonly failed: number;
  readonly modes: readonly TransferMode[];
  readonly error: StoredError | null;
  /**
   * A job that finished and moved nothing: an analysis whose files wait in Arrivals or sit in an
   * organized library. It stays in the database and in `all`, but a default view leaves it out.
   */
  readonly routine: boolean;
}

/** What a history read looks up per line, fetched once per request instead of once per line. */
interface Lookups {
  /** The latest execution of each batch, by batch id. */
  readonly executions: ReadonlyMap<string, Execution>;
  readonly jobs: ReadonlyMap<string, Job>;
  readonly modes: ReadonlyMap<string, TransferMode>;
}

export class History {
  constructor(
    private readonly journal: Journal,
    private readonly executions: ExecutionStore,
    private readonly jobs: JobStore,
  ) {}

  /** Whether anything was ever transferred or tried, from the server or the CLI. */
  hasBatch(): boolean {
    // An execution that moved nothing has a job, which the caller counts already.
    return this.journal.hasBatches();
  }

  /**
   * Batches and jobs in one list, the most recent first. A job that has a batch is not listed on
   * its own (its batch is its line, and says where it came from); `all` keeps the jobs that
   * finished without moving anything, which a default view hides.
   */
  activity(options: { all: boolean; limit: number; offset: number }): {
    total: number;
    items: Activity[];
  } {
    const withBatch = this.executions.withBatch();
    const jobs = this.jobs.all();
    const lookups: Lookups = {
      // Newest first, so the first one seen for a batch is its latest.
      executions: withBatch.reduce((byBatch, execution) => {
        if (execution.batchId !== null && !byBatch.has(execution.batchId)) {
          byBatch.set(execution.batchId, execution);
        }
        return byBatch;
      }, new Map<string, Execution>()),
      jobs: new Map(jobs.map((job) => [job.id, job])),
      modes: this.jobs.modes(),
    };
    const batched = new Set(withBatch.filter(isFinished).map((execution) => execution.jobId));
    const executed = this.executions.jobsWithExecution();
    const unfinished = this.executions.unfinished();
    // A line of the page is one of the newest of its own kind: only that many batches are read.
    const wanted = options.offset + options.limit;
    const journaled = this.journal.batches(wanted);
    const lines = [
      ...this.batches(lookups, journaled).map((batch): Activity => ({
        id: batch.id,
        kind: 'batch',
        at: batch.at,
        status: batch.status,
        path: batch.origin?.path ?? null,
        operations: batch.operations,
        failed: batch.failed,
        modes: batch.modes,
        error: batch.error,
        routine: false,
      })),
      ...jobs
        .filter((job) => !batched.has(job.id))
        .map((job): Activity => {
          const mode = lookups.modes.get(job.id);
          return {
            id: job.id,
            kind: 'job',
            at: job.finishedAt ?? job.createdAt,
            // A job whose analysis is done but whose transfer is not is still at work.
            status: unfinished.get(job.id) ?? job.status,
            path: job.path,
            operations: 0,
            failed: 0,
            modes: mode ? [mode] : [],
            error: job.error,
            routine: job.status === 'done' && !executed.has(job.id),
          };
        }),
    ]
      .filter((line) => options.all || !line.routine)
      .sort((a, b) => b.at.localeCompare(a.at));
    // Batches left unread would all be listed (none is routine), so they only add to the count.
    const unread = this.journal.countBatches() - journaled.length;
    return {
      total: lines.length + unread,
      items: lines.slice(options.offset, options.offset + options.limit),
    };
  }

  private batches(lookups: Lookups, journaled: readonly JournalBatch[]): BatchSummary[] {
    // A finished execution whose batch the journal does not hold: it failed before writing.
    const failed = [...lookups.executions.values()].filter(
      (execution) =>
        isFinished(execution) &&
        execution.batchId !== null &&
        this.journal.batch(execution.batchId) === undefined,
    );
    return [
      ...journaled.map((batch) =>
        this.summarize(batch, lookups.executions.get(batch.batchId), lookups),
      ),
      ...failed.map((execution) => this.summarizeFailed(execution, lookups)),
    ];
  }

  get(id: string): BatchDetail | undefined {
    const batch = this.journal.batch(id);
    const execution = this.executions.ofBatch(id);
    if (!batch && !(execution && isFinished(execution))) {
      return undefined;
    }
    const job = execution && this.jobs.get(execution.jobId);
    const mode = execution && this.jobs.settings(execution.jobId)?.mode;
    const lookups: Lookups = {
      executions: new Map(execution ? [[id, execution]] : []),
      jobs: new Map(job ? [[job.id, job]] : []),
      modes: new Map(job && mode ? [[job.id, mode]] : []),
    };
    const summary = batch
      ? this.summarize(batch, execution, lookups)
      : this.summarizeFailed(execution as Execution, lookups);
    const journaled = this.journal.entriesOf(id);
    const failures = (execution?.failures ?? []).map((failure): BatchOperation => ({
      source: failure.path,
      destination: failure.destination,
      mode: mode ?? summary.modes[0] ?? 'copy',
      status: 'failed',
      error: failure.error,
    }));
    return {
      ...summary,
      items: [
        // Only the transfers: an NFO or an image is not a file the user sent and has no mode.
        ...journaled.flatMap((entry): BatchOperation[] =>
          entry.kind === 'transfer'
            ? [
                {
                  source: entry.source,
                  destination: entry.destination,
                  mode: entry.mode,
                  status: summary.status === 'undone' ? 'undone' : 'done',
                  error: null,
                },
              ]
            : [],
        ),
        ...failures,
      ],
      extras: journaled.flatMap((entry): BatchExtra[] =>
        entry.kind === 'transfer' ? [] : [{ kind: entry.kind, destination: entry.destination }],
      ),
    };
  }

  private summarize(
    batch: JournalBatch,
    execution: Execution | undefined,
    lookups: Lookups,
  ): BatchSummary {
    return {
      id: batch.batchId,
      at: batch.at,
      status: unfinishedStatus(execution) ?? (batch.undone ? 'undone' : 'done'),
      operations: batch.operations,
      modes: batch.modes,
      failed: execution?.summary?.failed ?? 0,
      origin: originOf(execution, lookups),
      error: null,
    };
  }

  private summarizeFailed(execution: Execution, lookups: Lookups): BatchSummary {
    const mode = lookups.modes.get(execution.jobId);
    return {
      id: execution.batchId ?? execution.id,
      at: execution.finishedAt ?? execution.createdAt,
      status: 'failed',
      operations: 0,
      modes: mode ? [mode] : [],
      failed: execution.summary?.failed ?? execution.failures.length,
      origin: originOf(execution, lookups),
      error: execution.error ?? execution.failures[0]?.error ?? null,
    };
  }
}

/** `queued` or `running` while the transfer is not over, so a line never says "done" too soon. */
const unfinishedStatus = (execution: Execution | undefined): 'queued' | 'running' | undefined =>
  execution?.status === 'queued' || execution?.status === 'running' ? execution.status : undefined;

const isFinished = (execution: Execution): boolean =>
  execution.status === 'done' || execution.status === 'failed';

function originOf(execution: Execution | undefined, lookups: Lookups): BatchOrigin | null {
  const job = execution && lookups.jobs.get(execution.jobId);
  return job ? { jobId: job.id, path: job.path } : null;
}
