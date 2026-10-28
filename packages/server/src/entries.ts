import { randomUUID } from 'node:crypto';
import type {
  AnalysisEntry,
  Classification,
  ExternalId,
  ParsedMedia,
  PlanItem,
  ScoredCandidate,
} from '@kinoshelf/core';
import type { Database } from 'better-sqlite3';

/** How a file left the queue: transferred, failed (needs a human again) or set aside. */
export type Resolution = 'done' | 'failed' | 'ignored';

export interface StoredError {
  readonly code: string;
  readonly params?: Readonly<Record<string, string | number>>;
}

/** What the queue shows of a candidate: enough to choose, not what scoring needed. */
export interface StoredCandidate {
  readonly kind: 'movie' | 'series';
  readonly id: ExternalId;
  readonly title: string;
  readonly originalTitle: string;
  readonly year?: number;
  readonly posterPath?: string;
  readonly score: number;
}

export interface Entry {
  readonly id: string;
  readonly jobId: string;
  readonly path: string;
  readonly classification: Classification;
  readonly resolution: Resolution | null;
  readonly parsed: ParsedMedia;
  readonly reason: string | null;
  readonly candidates: readonly StoredCandidate[];
  readonly item: PlanItem | null;
  readonly error: StoredError | null;
  readonly batchId: string | null;
}

export type JobSummary = Record<Classification, number>;

interface EntryRow {
  id: string;
  job_id: string;
  path: string;
  classification: Classification;
  resolution: Resolution | null;
  parsed: string;
  outcome: string;
  item: string | null;
  error: string | null;
  batch_id: string | null;
}

const COLUMNS =
  'id, job_id, path, classification, resolution, parsed, outcome, item, error, batch_id';

/** Candidates kept per file: the runner-ups a human needs, a few kilobytes less than all of them. */
const KEPT_CANDIDATES = 4;

/** Waiting for a human: nothing decided, or an execution that failed. */
const IN_QUEUE =
  "((classification IN ('ambiguous', 'unrecognized', 'conflict') AND resolution IS NULL) OR resolution = 'failed')";

const compact = ({ candidate, score }: ScoredCandidate): StoredCandidate => ({
  kind: candidate.kind,
  id: candidate.id,
  title: candidate.title,
  originalTitle: candidate.originalTitle,
  ...(candidate.year !== undefined && { year: candidate.year }),
  ...(candidate.posterPath !== undefined && { posterPath: candidate.posterPath }),
  score,
});

function outcomeOf(entry: AnalysisEntry): { reason?: string; candidates: StoredCandidate[] } {
  const { outcome } = entry;
  if (outcome.status === 'unrecognized') {
    return { reason: outcome.reason, candidates: [] };
  }
  const ranked =
    outcome.status === 'matched' ? [outcome.best, ...outcome.others] : outcome.candidates;
  return { candidates: ranked.slice(0, KEPT_CANDIDATES).map(compact) };
}

function toEntry(row: EntryRow): Entry {
  const outcome = JSON.parse(row.outcome) as { reason?: string; candidates: StoredCandidate[] };
  return {
    id: row.id,
    jobId: row.job_id,
    path: row.path,
    classification: row.classification,
    resolution: row.resolution,
    parsed: JSON.parse(row.parsed) as ParsedMedia,
    reason: outcome.reason ?? null,
    candidates: outcome.candidates,
    item: row.item === null ? null : (JSON.parse(row.item) as PlanItem),
    error: row.error === null ? null : (JSON.parse(row.error) as StoredError),
    batchId: row.batch_id,
  };
}

/** The files of the jobs and what became of each: the validation queue is a view over them. */
export class EntryStore {
  constructor(private readonly database: Database) {}

  insertAll(jobId: string, entries: readonly AnalysisEntry[]): void {
    const insert = this.database.prepare(
      `INSERT INTO job_entries (id, job_id, path, classification, parsed, outcome, item)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.database.transaction(() => {
      for (const entry of entries) {
        insert.run(
          randomUUID(),
          jobId,
          entry.file.path,
          entry.classification,
          JSON.stringify(entry.parsed),
          JSON.stringify(outcomeOf(entry)),
          entry.item ? JSON.stringify(entry.item) : null,
        );
      }
    })();
  }

  get(id: string): Entry | undefined {
    const row = this.database
      .prepare<[string], EntryRow>(`SELECT ${COLUMNS} FROM job_entries WHERE id = ?`)
      .get(id);
    return row && toEntry(row);
  }

  list(
    jobId: string,
    options: { classification?: Classification; limit: number; offset: number },
  ): Entry[] {
    const filter = options.classification ? 'AND classification = ?' : '';
    const params = [jobId, ...(options.classification ? [options.classification] : [])];
    return this.database
      .prepare<unknown[], EntryRow>(
        `SELECT ${COLUMNS} FROM job_entries WHERE job_id = ? ${filter} ORDER BY seq LIMIT ? OFFSET ?`,
      )
      .all(...params, options.limit, options.offset)
      .map(toEntry);
  }

  queue(options: { limit: number; offset: number }): Entry[] {
    return this.database
      .prepare<[number, number], EntryRow>(
        `SELECT ${COLUMNS} FROM job_entries WHERE ${IN_QUEUE} ORDER BY seq LIMIT ? OFFSET ?`,
      )
      .all(options.limit, options.offset)
      .map(toEntry);
  }

  /** Files matched and not transferred yet (a failed attempt may be retried). */
  executable(jobId: string): Entry[] {
    return this.database
      .prepare<[string], EntryRow>(
        `SELECT ${COLUMNS} FROM job_entries
         WHERE job_id = ? AND classification = 'to-rename'
           AND (resolution IS NULL OR resolution = 'failed')
         ORDER BY seq`,
      )
      .all(jobId)
      .map(toEntry);
  }

  summary(jobId: string): JobSummary {
    const summary: JobSummary = {
      compliant: 0,
      'to-rename': 0,
      conflict: 0,
      ambiguous: 0,
      unrecognized: 0,
    };
    const rows = this.database
      .prepare<[string], { classification: Classification; total: number }>(
        'SELECT classification, COUNT(*) AS total FROM job_entries WHERE job_id = ? GROUP BY classification',
      )
      .all(jobId);
    for (const row of rows) {
      summary[row.classification] = row.total;
    }
    return summary;
  }

  /** A human chose a candidate: the file is re-planned and leaves the queue (or hits a conflict). */
  setMatch(id: string, classification: Classification, item: PlanItem): void {
    this.database
      .prepare(
        'UPDATE job_entries SET classification = ?, item = ?, resolution = NULL, error = NULL WHERE id = ?',
      )
      .run(classification, JSON.stringify(item), id);
  }

  resolve(
    id: string,
    resolution: Resolution,
    details: { batchId?: string; error?: StoredError } = {},
  ): void {
    this.database
      .prepare('UPDATE job_entries SET resolution = ?, batch_id = ?, error = ? WHERE id = ?')
      .run(
        resolution,
        details.batchId ?? null,
        details.error ? JSON.stringify(details.error) : null,
        id,
      );
  }

  /** The batch was undone: its files are ready to be transferred again. */
  reopenBatch(batchId: string): void {
    this.database
      .prepare(
        'UPDATE job_entries SET resolution = NULL, batch_id = NULL, error = NULL WHERE batch_id = ?',
      )
      .run(batchId);
  }
}
