import { randomUUID } from 'node:crypto';
import type { Analysis, DestinationRoots, TransferMode } from '@kinoshelf/core';
import type { Database } from 'better-sqlite3';
import type { StoredError, EntryStore } from './entries.js';
import type { ExecutionStore } from './executions.js';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

/**
 * What the plan was built with. Kept with the job so a file matched by hand later is planned the
 * same way as the others, whatever `config.yaml` says by then.
 */
export interface PlanSettings {
  /** A bundled profile id or a path, as `loadProfile` takes it. */
  readonly profile: string;
  readonly mode: TransferMode;
  readonly destinationRoot: DestinationRoots;
}

export interface ProcessedJob {
  readonly analysis: Analysis;
  readonly settings: PlanSettings;
}

export interface Job {
  readonly id: string;
  readonly path: string;
  readonly status: JobStatus;
  /** Execute the matched files as soon as the analysis is done. */
  readonly apply: boolean;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly error: StoredError | null;
}

interface JobRow {
  id: string;
  path: string;
  status: JobStatus;
  apply: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

const COLUMNS = 'id, path, status, apply, created_at, started_at, finished_at, error';

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    path: row.path,
    status: row.status,
    apply: row.apply === 1,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error === null ? null : (JSON.parse(row.error) as StoredError),
  };
}

/** Durable job queue in the server's SQLite file; the files of a job live in `EntryStore`. */
export class JobStore {
  constructor(
    private readonly database: Database,
    private readonly entries: EntryStore,
    private readonly executions: ExecutionStore,
  ) {}

  create(path: string, apply = false): Job {
    const id = randomUUID();
    this.database
      .prepare(
        "INSERT INTO jobs (id, path, status, apply, created_at) VALUES (?, ?, 'queued', ?, ?)",
      )
      .run(id, path, apply ? 1 : 0, new Date().toISOString());
    return this.require(id);
  }

  get(id: string): Job | undefined {
    const row = this.database
      .prepare<[string], JobRow>(`SELECT ${COLUMNS} FROM jobs WHERE id = ?`)
      .get(id);
    return row && toJob(row);
  }

  /** Newest first. */
  list(limit: number): Job[] {
    return this.database
      .prepare<[number], JobRow>(`SELECT ${COLUMNS} FROM jobs ORDER BY seq DESC LIMIT ?`)
      .all(limit)
      .map(toJob);
  }

  settings(id: string): PlanSettings | undefined {
    const row = this.database
      .prepare<[string], { settings: string | null }>('SELECT settings FROM jobs WHERE id = ?')
      .get(id);
    return row?.settings ? (JSON.parse(row.settings) as PlanSettings) : undefined;
  }

  /** Takes the oldest queued job and marks it running; the queue is served in order. */
  claimNext(): Job | undefined {
    return this.database.transaction((): Job | undefined => {
      const row = this.database
        .prepare<[], { id: string }>(
          "SELECT id FROM jobs WHERE status = 'queued' ORDER BY seq LIMIT 1",
        )
        .get();
      if (!row) {
        return undefined;
      }
      this.database
        .prepare("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?")
        .run(new Date().toISOString(), row.id);
      return this.require(row.id);
    })();
  }

  /**
   * Files and status land together: a crash cannot leave a `done` job without its files. An
   * `apply` job gets its execution in the same transaction, so it cannot be lost either.
   */
  complete(job: Job, processed: ProcessedJob): void {
    this.database.transaction(() => {
      this.entries.insertAll(job.id, processed.analysis.entries);
      this.database
        .prepare("UPDATE jobs SET status = 'done', finished_at = ?, settings = ? WHERE id = ?")
        .run(new Date().toISOString(), JSON.stringify(processed.settings), job.id);
      if (job.apply) {
        this.executions.createIfIdle(job.id);
      }
    })();
  }

  fail(id: string, error: StoredError): void {
    this.database
      .prepare("UPDATE jobs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?")
      .run(new Date().toISOString(), JSON.stringify(error), id);
  }

  /** A crash leaves jobs `running`; nothing was written (analysis is read-only), so rerun them. */
  requeueRunning(): void {
    this.database
      .prepare("UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'running'")
      .run();
  }

  private require(id: string): Job {
    const job = this.get(id);
    if (!job) {
      throw new Error(`job ${id} vanished`);
    }
    return job;
  }
}
