import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { StoredError } from './entries.js';

export type ExecutionStatus = 'queued' | 'running' | 'done' | 'failed';

/** Files transferred and files that did not go through, in this execution. */
export interface ExecutionSummary {
  readonly done: number;
  readonly failed: number;
}

/** A file that did not go through, as it was when the execution ended. */
export interface ExecutionFailure {
  readonly path: string;
  readonly destination: string | null;
  readonly error: StoredError;
}

export interface Execution {
  readonly id: string;
  readonly jobId: string;
  readonly status: ExecutionStatus;
  /** Only these files, or every file of the job still to transfer. */
  readonly entryIds: readonly string[] | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  /** The batch of this execution, kept when it is resumed after a crash: one undo reverts it all. */
  readonly batchId: string | null;
  readonly summary: ExecutionSummary | null;
  readonly error: StoredError | null;
  readonly failures: readonly ExecutionFailure[];
}

interface ExecutionRow {
  id: string;
  job_id: string;
  status: ExecutionStatus;
  entry_ids: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  batch_id: string | null;
  summary: string | null;
  error: string | null;
  failures: string | null;
}

const COLUMNS =
  'id, job_id, status, entry_ids, created_at, started_at, finished_at, batch_id, summary, error, failures';

function toExecution(row: ExecutionRow): Execution {
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status,
    entryIds: row.entry_ids === null ? null : (JSON.parse(row.entry_ids) as string[]),
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    batchId: row.batch_id,
    summary: row.summary === null ? null : (JSON.parse(row.summary) as ExecutionSummary),
    error: row.error === null ? null : (JSON.parse(row.error) as StoredError),
    failures: row.failures === null ? [] : (JSON.parse(row.failures) as ExecutionFailure[]),
  };
}

/** Transfers waiting for, or going through, the queue worker. */
export class ExecutionStore {
  constructor(private readonly database: Database) {}

  /**
   * Queues an execution unless one is already queued or running for the job, which would copy the
   * same files twice. Check and insert are one transaction.
   */
  createIfIdle(jobId: string, entryIds?: readonly string[]): Execution | undefined {
    return this.database.transaction((): Execution | undefined => {
      if (this.hasPending(jobId)) {
        return undefined;
      }
      const id = randomUUID();
      this.database
        .prepare(
          "INSERT INTO executions (id, job_id, status, entry_ids, created_at) VALUES (?, ?, 'queued', ?, ?)",
        )
        .run(id, jobId, entryIds ? JSON.stringify(entryIds) : null, new Date().toISOString());
      return this.require(id);
    })();
  }

  hasPending(jobId: string): boolean {
    return (
      this.database
        .prepare("SELECT 1 FROM executions WHERE job_id = ? AND status IN ('queued', 'running')")
        .get(jobId) !== undefined
    );
  }

  get(id: string): Execution | undefined {
    const row = this.database
      .prepare<[string], ExecutionRow>(`SELECT ${COLUMNS} FROM executions WHERE id = ?`)
      .get(id);
    return row && toExecution(row);
  }

  /** The execution that ran under this batch, if the batch came from the server. */
  ofBatch(batchId: string): Execution | undefined {
    const row = this.database
      .prepare<[string], ExecutionRow>(
        `SELECT ${COLUMNS} FROM executions WHERE batch_id = ? ORDER BY seq DESC LIMIT 1`,
      )
      .get(batchId);
    return row && toExecution(row);
  }

  /**
   * Finished executions that settled a batch, newest first. History shows those that moved
   * nothing too, which the journal never saw.
   */
  finishedWithBatch(): Execution[] {
    return this.database
      .prepare<[], ExecutionRow>(
        `SELECT ${COLUMNS} FROM executions
         WHERE batch_id IS NOT NULL AND status IN ('done', 'failed') ORDER BY seq DESC`,
      )
      .all()
      .map(toExecution);
  }

  latestOf(jobId: string): Execution | undefined {
    const row = this.database
      .prepare<[string], ExecutionRow>(
        `SELECT ${COLUMNS} FROM executions WHERE job_id = ? ORDER BY seq DESC LIMIT 1`,
      )
      .get(jobId);
    return row && toExecution(row);
  }

  /** The oldest queued execution, marked running. */
  claimNext(): Execution | undefined {
    return this.database.transaction((): Execution | undefined => {
      const row = this.database
        .prepare<[], { id: string }>(
          "SELECT id FROM executions WHERE status = 'queued' ORDER BY seq LIMIT 1",
        )
        .get();
      if (!row) {
        return undefined;
      }
      this.database
        .prepare("UPDATE executions SET status = 'running', started_at = ? WHERE id = ?")
        .run(new Date().toISOString(), row.id);
      return this.require(row.id);
    })();
  }

  /** Recorded before the first transfer, so a resumed execution carries on the same batch. */
  setBatch(id: string, batchId: string): void {
    this.database.prepare('UPDATE executions SET batch_id = ? WHERE id = ?').run(batchId, id);
  }

  complete(
    id: string,
    summary: ExecutionSummary,
    failures: readonly ExecutionFailure[] = [],
  ): void {
    this.database
      .prepare(
        "UPDATE executions SET status = 'done', finished_at = ?, summary = ?, failures = ? WHERE id = ?",
      )
      .run(
        new Date().toISOString(),
        JSON.stringify(summary),
        failures.length > 0 ? JSON.stringify(failures) : null,
        id,
      );
  }

  fail(id: string, error: StoredError): void {
    this.database
      .prepare("UPDATE executions SET status = 'failed', finished_at = ?, error = ? WHERE id = ?")
      .run(new Date().toISOString(), JSON.stringify(error), id);
  }

  /**
   * A crash leaves executions `running`. Run again, they only do what is left: each file was
   * settled as soon as it was transferred, so the ones already done are not executable any more.
   */
  requeueRunning(): void {
    this.database
      .prepare(
        "UPDATE executions SET status = 'queued', started_at = NULL WHERE status = 'running'",
      )
      .run();
  }

  private require(id: string): Execution {
    const execution = this.get(id);
    if (!execution) {
      throw new Error(`execution ${id} vanished`);
    }
    return execution;
  }
}
