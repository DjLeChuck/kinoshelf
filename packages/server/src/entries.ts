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
  /** The library an arrival was sent to by hand; null: the default one. */
  readonly destinationLibraryId: string | null;
  /** The folder (or file) it came in; episodes of one release are validated together. */
  readonly release: string | null;
  /** Which series of the release it is: 0 for the main one, 1 and up for the others in the folder. */
  readonly cluster: number;
  /** An episode of another series than the folder's main one. */
  readonly detached: boolean;
}

export type JobSummary = Record<Classification, number>;

/** What kind of work a file is, as its name reads: a movie, an episode of a series, or unknown. */
export const workKindOf = (entry: Pick<Entry, 'parsed'>): 'movie' | 'series' | null =>
  entry.parsed.kind === 'movie' ? 'movie' : entry.parsed.kind === 'episode' ? 'series' : null;

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
  destination_library_id: string | null;
  release: string | null;
  cluster: number;
}

const COLUMNS =
  'id, job_id, path, classification, resolution, parsed, outcome, item, error, batch_id, destination_library_id, release, cluster';

/** Candidates kept per file: the runner-ups a human needs, a few kilobytes less than all of them. */
const KEPT_CANDIDATES = 4;

const compact = ({
  candidate,
  score,
}: Pick<ScoredCandidate, 'candidate' | 'score'>): StoredCandidate => ({
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
    destinationLibraryId: row.destination_library_id,
    release: row.release,
    cluster: row.cluster,
    detached: row.cluster > 0,
  };
}

/** The files of the jobs and what became of each: the validation queue is a view over them. */
export class EntryStore {
  constructor(private readonly database: Database) {}

  insertAll(jobId: string, entries: readonly AnalysisEntry[]): void {
    const insert = this.database.prepare(
      `INSERT INTO job_entries (id, job_id, path, classification, parsed, outcome, item, release, cluster)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          entry.file.release,
          entry.cluster,
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

  /** Every file of a job, in the order it was analyzed. */
  list(jobId: string): Entry[] {
    return this.database
      .prepare<[string], EntryRow>(
        `SELECT ${COLUMNS} FROM job_entries WHERE job_id = ? ORDER BY seq`,
      )
      .all(jobId)
      .map(toEntry);
  }

  /**
   * Maps every file of a job without keeping them: a scan of tens of thousands of files would
   * otherwise hold all their parsed JSON at once.
   */
  mapList<T>(jobId: string, map: (entry: Entry) => T): T[] {
    return this.database
      .prepare<[string], EntryRow>(
        `SELECT ${COLUMNS} FROM job_entries WHERE job_id = ? ORDER BY seq`,
      )
      .all(jobId)
      .map((row) => map(toEntry(row)));
  }

  /** The ids of the files `executable` returns that carry a plan, without reading any of them. */
  executableIds(jobId: string): Set<string> {
    return new Set(
      this.database
        .prepare<[string], { id: string }>(
          `SELECT id FROM job_entries
           WHERE job_id = ? AND classification = 'to-rename' AND item IS NOT NULL
             AND (resolution IS NULL OR resolution = 'failed')`,
        )
        .all(jobId)
        .map(({ id }) => id),
    );
  }

  /**
   * Files of the arrival folders (and of jobs sent by hand, which belong to none) that wait for a
   * human: a file to choose a work for, or one whose transfer failed. A scan of a library
   * organized in place never lands here: what it holds is already where it lives.
   */
  arrivals(options: {
    arrivalIds: readonly string[];
    state?: 'review' | 'unrecognized';
    limit: number;
    offset: number;
  }): { total: number; entries: Entry[] } {
    const marks = options.arrivalIds.map(() => '?').join(', ');
    const review =
      "((classification IN ('ambiguous', 'conflict') AND resolution IS NULL) OR resolution = 'failed')";
    const unrecognized = "(classification = 'unrecognized' AND resolution IS NULL)";
    const state =
      options.state === 'review'
        ? review
        : options.state === 'unrecognized'
          ? unrecognized
          : `(${review} OR ${unrecognized})`;
    const where = `${state} AND job_id IN (
      SELECT id FROM jobs WHERE library_id IS NULL${marks ? ` OR library_id IN (${marks})` : ''})`;
    const total =
      this.database
        .prepare<string[], { total: number }>(
          `SELECT COUNT(*) AS total FROM job_entries WHERE ${where}`,
        )
        .get(...options.arrivalIds)?.total ?? 0;
    // The page counts releases, not files: a release is never cut between two pages.
    const group = "job_id || '|' || COALESCE(release, path)";
    const keys = this.database
      .prepare<(string | number)[], { key: string }>(
        `SELECT ${group} AS key FROM job_entries WHERE ${where}
         GROUP BY key ORDER BY MIN(seq) LIMIT ? OFFSET ?`,
      )
      .all(...options.arrivalIds, options.limit, options.offset)
      .map(({ key }) => key);
    const entries =
      keys.length === 0
        ? []
        : this.database
            .prepare<string[], EntryRow>(
              `SELECT ${COLUMNS} FROM job_entries
               WHERE ${where} AND ${group} IN (${keys.map(() => '?').join(', ')}) ORDER BY seq`,
            )
            .all(...options.arrivalIds, ...keys)
            .map(toEntry);
    return { total, entries };
  }

  /**
   * The other episodes validated along with this one: same job, same release, same series of the
   * folder, none handled yet. Empty for anything but an episode.
   */
  releaseMates(entry: Entry): Entry[] {
    if (entry.release === null || entry.parsed.kind !== 'episode') {
      return [];
    }
    return this.database
      .prepare<[string, string, string, number], EntryRow>(
        `SELECT ${COLUMNS} FROM job_entries
         WHERE job_id = ? AND release = ? AND id != ? AND cluster = ?
           AND resolution IS NULL AND classification != 'compliant'
         ORDER BY seq`,
      )
      .all(entry.jobId, entry.release, entry.id, entry.cluster)
      .map(toEntry)
      .filter((other) => other.parsed.kind === 'episode');
  }

  /** Where a file goes once transferred, chosen by hand; null: the default. */
  setDestination(id: string, libraryId: string | null): void {
    this.database
      .prepare('UPDATE job_entries SET destination_library_id = ? WHERE id = ?')
      .run(libraryId, id);
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

  /**
   * A human chose a candidate: the file is re-planned and leaves the queue (or hits a conflict).
   * The chosen work is kept first among the candidates, since a search may have found it outside
   * what the scan proposed and its title is what the library will show.
   */
  setMatch(
    id: string,
    classification: Classification,
    item: PlanItem,
    chosen?: Pick<ScoredCandidate, 'candidate' | 'score'>,
  ): void {
    this.database.transaction(() => {
      this.database
        .prepare(
          'UPDATE job_entries SET classification = ?, item = ?, resolution = NULL, error = NULL WHERE id = ?',
        )
        .run(classification, JSON.stringify(item), id);
      const row = chosen
        ? this.database
            .prepare<[string], { outcome: string }>('SELECT outcome FROM job_entries WHERE id = ?')
            .get(id)
        : undefined;
      if (chosen && row) {
        const outcome = JSON.parse(row.outcome) as {
          reason?: string;
          candidates: StoredCandidate[];
        };
        const kept = outcome.candidates.find((c) => c.id.id === chosen.candidate.id.id);
        const candidates = [
          { ...compact(chosen), ...(kept && { score: kept.score }) },
          ...outcome.candidates.filter((c) => c.id.id !== chosen.candidate.id.id),
        ].slice(0, KEPT_CANDIDATES);
        this.database
          .prepare('UPDATE job_entries SET outcome = ? WHERE id = ?')
          .run(JSON.stringify({ ...outcome, candidates }), id);
      }
    })();
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
