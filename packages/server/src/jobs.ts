import { randomUUID } from 'node:crypto';
import type { Analysis, Classification } from '@kinoshelf/core';
import type { Database } from 'better-sqlite3';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

/** Same shape as the core's `ErrorInfo`, but also carries the server's own codes. */
export interface JobError {
  readonly code: string;
  readonly params?: Readonly<Record<string, string | number>>;
}

export type JobSummary = Record<Classification, number>;

export interface Job {
  readonly id: string;
  readonly path: string;
  readonly status: JobStatus;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly error: JobError | null;
  readonly summary: JobSummary | null;
}

interface JobRow {
  id: string;
  path: string;
  status: JobStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  summary: string | null;
}

const COLUMNS = 'id, path, status, created_at, started_at, finished_at, error, summary';

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    path: row.path,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error === null ? null : (JSON.parse(row.error) as JobError),
    summary: row.summary === null ? null : (JSON.parse(row.summary) as JobSummary),
  };
}

export function summarize(analysis: Analysis): JobSummary {
  const summary: JobSummary = {
    compliant: 0,
    'to-rename': 0,
    conflict: 0,
    ambiguous: 0,
    unrecognized: 0,
  };
  for (const entry of analysis.entries) {
    summary[entry.classification]++;
  }
  return summary;
}

/**
 * Durable job queue in the server's SQLite file. The analysis is kept whole: the validation queue
 * (candidates, plan items) is built from it, so a job survives a restart with nothing to redo.
 */
export class JobStore {
  constructor(private readonly database: Database) {}

  create(path: string): Job {
    const id = randomUUID();
    this.database
      .prepare("INSERT INTO jobs (id, path, status, created_at) VALUES (?, ?, 'queued', ?)")
      .run(id, path, new Date().toISOString());
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

  /** The stored analysis of a finished job. */
  analysis(id: string): Analysis | undefined {
    const row = this.database
      .prepare<[string], { analysis: string | null }>('SELECT analysis FROM jobs WHERE id = ?')
      .get(id);
    return row?.analysis ? (JSON.parse(row.analysis) as Analysis) : undefined;
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

  complete(id: string, analysis: Analysis): void {
    this.database
      .prepare(
        "UPDATE jobs SET status = 'done', finished_at = ?, summary = ?, analysis = ? WHERE id = ?",
      )
      .run(
        new Date().toISOString(),
        JSON.stringify(summarize(analysis)),
        JSON.stringify(analysis),
        id,
      );
  }

  fail(id: string, error: JobError): void {
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
