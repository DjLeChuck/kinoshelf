import type { Journal, JournalBatch, TransferMode } from '@kinoshelf/core';
import type { StoredError } from './entries.js';
import type { Execution, ExecutionStore } from './executions.js';
import type { JobStore } from './jobs.js';

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
  readonly status: BatchStatus;
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

export interface BatchDetail extends BatchSummary {
  readonly items: readonly BatchOperation[];
}

export class History {
  constructor(
    private readonly journal: Journal,
    private readonly executions: ExecutionStore,
    private readonly jobs: JobStore,
  ) {}

  /** Journal batches and the executions that moved nothing, the most recent first. */
  list(options: { limit: number; offset: number }): BatchSummary[] {
    const journaled = this.journal.batches();
    const known = new Set(journaled.map((batch) => batch.batchId));
    const failed = this.executions
      .finishedWithBatch()
      .filter((execution) => execution.batchId !== null && !known.has(execution.batchId));
    const all = [
      ...journaled.map((batch) => this.summarize(batch)),
      ...failed.map((execution) => this.summarizeFailed(execution)),
    ].sort((a, b) => b.at.localeCompare(a.at));
    return all.slice(options.offset, options.offset + options.limit);
  }

  get(id: string): BatchDetail | undefined {
    const batch = this.journal.batches().find((candidate) => candidate.batchId === id);
    const execution = this.executions.ofBatch(id);
    if (!batch && !(execution && execution.status !== 'queued' && execution.status !== 'running')) {
      return undefined;
    }
    const summary = batch ? this.summarize(batch) : this.summarizeFailed(execution as Execution);
    const mode = this.modeOf(execution);
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
    };
  }

  private summarize(batch: JournalBatch): BatchSummary {
    const execution = this.executions.ofBatch(batch.batchId);
    return {
      id: batch.batchId,
      at: batch.at,
      status: batch.undone ? 'undone' : 'done',
      operations: batch.operations,
      modes: batch.modes,
      failed: execution?.summary?.failed ?? 0,
      origin: this.originOf(execution),
      error: null,
    };
  }

  private summarizeFailed(execution: Execution): BatchSummary {
    const mode = this.modeOf(execution);
    return {
      id: execution.batchId ?? execution.id,
      at: execution.finishedAt ?? execution.createdAt,
      status: 'failed',
      operations: 0,
      modes: mode ? [mode] : [],
      failed: execution.summary?.failed ?? execution.failures.length,
      origin: this.originOf(execution),
      error: execution.error ?? execution.failures[0]?.error ?? null,
    };
  }

  private originOf(execution: Execution | undefined): BatchOrigin | null {
    const job = execution && this.jobs.get(execution.jobId);
    return job ? { jobId: job.id, path: job.path } : null;
  }

  private modeOf(execution: Execution | undefined): TransferMode | undefined {
    return execution && this.jobs.settings(execution.jobId)?.mode;
  }
}
