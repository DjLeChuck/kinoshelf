import { randomUUID } from 'node:crypto';
import type {
  AnalysisEntry,
  Classification,
  ExternalId,
  ParsedMedia,
  PlanItem,
  ScoredCandidate,
} from '@kinoshelf/core';
import type { Database } from '@kinoshelf/core';
import type { Duplicate } from './duplicates.js';
import {
  openEntry,
  PRESENT_ENTRY,
  READY_ENTRY,
  REVIEW_ENTRY,
  UNRECOGNIZED_ENTRY,
} from './entry-sql.js';

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
  /** The file's season and episode are not in TMDB's season, which caps the score (absent: no). */
  readonly episodeUnknown?: true;
  /** …because TMDB has no such season at all (a 404), not only no such episode. */
  readonly seasonUnknown?: true;
  /** What keeps the score from being full (`title`, `year`, `country`…), see `ScoreLimit`. */
  readonly limits?: readonly string[];
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
  /** What the destination library already holds of it; null: nothing, or never compared. */
  readonly duplicate: StoredDuplicate | null;
}

/** A verdict of `DuplicateFinder` as stored, with the owner's "process it anyway". */
export interface StoredDuplicate extends Duplicate {
  /** `asked`: process it anyway, to validate. `confirmed`: validated, it goes out like the others. */
  readonly forced: 'asked' | 'confirmed' | null;
}

/** The states Arrivals lists; every waiting file is in exactly one. */
export type ArrivalState = 'ready' | 'review' | 'unrecognized' | 'present';

const STATES: Record<ArrivalState, string> = {
  ready: READY_ENTRY,
  review: REVIEW_ENTRY,
  unrecognized: UNRECOGNIZED_ENTRY,
  present: PRESENT_ENTRY,
};

const ANY_STATE = `(${Object.values(STATES).join(' OR ')})`;

/** What a bulk action needs to know of a file before it is read whole. */
export interface EntrySeed {
  readonly id: string;
  readonly jobId: string;
  readonly release: string | null;
  readonly cluster: number;
  /** An episode: settled with the rest of its release and series. */
  readonly episode: boolean;
}

interface SeedRow {
  id: string;
  job_id: string;
  release: string | null;
  cluster: number;
  episode: number;
}

const seedOf = (row: SeedRow): EntrySeed => ({
  id: row.id,
  jobId: row.job_id,
  release: row.release,
  cluster: row.cluster,
  episode: row.episode === 1,
});

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
  duplicate_kind: StoredDuplicate['kind'] | null;
  duplicate_path: string | null;
  duplicate_library_id: string | null;
  duplicate_size: number | null;
  duplicate_forced: number;
}

const COLUMNS =
  'id, job_id, path, classification, resolution, parsed, outcome, item, error, batch_id, destination_library_id, release, cluster, duplicate_kind, duplicate_path, duplicate_library_id, duplicate_size, duplicate_forced';

/** Candidates kept per file: the runner-ups a human needs, a few kilobytes less than all of them. */
const KEPT_CANDIDATES = 4;

const compact = (
  {
    candidate,
    score,
    breakdown,
    seasonMissing,
    limits,
  }: Pick<ScoredCandidate, 'candidate' | 'score'> &
    Partial<Pick<ScoredCandidate, 'breakdown' | 'seasonMissing' | 'limits'>>,
  parsed: ParsedMedia,
): StoredCandidate => ({
  kind: candidate.kind,
  id: candidate.id,
  title: candidate.title,
  originalTitle: candidate.originalTitle,
  ...(candidate.year !== undefined && { year: candidate.year }),
  ...(candidate.posterPath !== undefined && { posterPath: candidate.posterPath }),
  score,
  ...(limits !== undefined && limits.length > 0 && { limits }),
  // A choice made by hand has no breakdown: it says nothing of the season.
  ...(parsed.kind === 'episode' &&
    candidate.kind === 'series' &&
    breakdown !== undefined &&
    breakdown.episodeExists === 0 && {
      episodeUnknown: true as const,
      ...(seasonMissing && { seasonUnknown: true as const }),
    }),
});

function outcomeOf(entry: AnalysisEntry): { reason?: string; candidates: StoredCandidate[] } {
  const { outcome } = entry;
  if (outcome.status === 'unrecognized') {
    return { reason: outcome.reason, candidates: [] };
  }
  const ranked =
    outcome.status === 'matched' ? [outcome.best, ...outcome.others] : outcome.candidates;
  return {
    candidates: ranked.slice(0, KEPT_CANDIDATES).map((scored) => compact(scored, entry.parsed)),
  };
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
    duplicate:
      row.duplicate_kind === null ||
      row.duplicate_path === null ||
      row.duplicate_library_id === null
        ? null
        : {
            kind: row.duplicate_kind,
            path: row.duplicate_path,
            libraryId: row.duplicate_library_id,
            size: row.duplicate_size,
            forced: ([null, 'asked', 'confirmed'] as const)[row.duplicate_forced] ?? null,
          },
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

  /**
   * The ids of the files whose version could be named now: a planned movie (in place or waiting to
   * be renamed) nobody has settled yet, without reading any of them.
   */
  versionableIds(jobId: string): Set<string> {
    return new Set(
      this.database
        .prepare<[string], { id: string }>(
          `SELECT id FROM job_entries
           WHERE job_id = ? AND classification IN ('compliant', 'to-rename') AND item IS NOT NULL
             AND ${openEntry()}`,
        )
        .all(jobId)
        .map(({ id }) => id),
    );
  }

  /** The ids of the files `executable` returns that carry a plan, without reading any of them. */
  executableIds(jobId: string): Set<string> {
    return new Set(
      this.database
        .prepare<[string], { id: string }>(
          `SELECT id FROM job_entries
           WHERE job_id = ? AND classification = 'to-rename' AND item IS NOT NULL
             AND ${openEntry()} AND NOT ${PRESENT_ENTRY}`,
        )
        .all(jobId)
        .map(({ id }) => id),
    );
  }

  /**
   * Files of the arrival folders (and of jobs sent by hand, which belong to none) that wait for a
   * human: a file to choose a work for, one whose transfer failed, or one matched with confidence
   * whose transfer nobody started (`ready`). A scan of a library
   * organized in place never lands here: what it holds is already where it lives.
   */
  arrivals(options: {
    arrivalIds: readonly string[];
    state?: ArrivalState;
    limit: number;
    offset: number;
  }): { total: number; entries: Entry[] } {
    const marks = options.arrivalIds.map(() => '?').join(', ');
    const state = options.state ? STATES[options.state] : ANY_STATE;
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

  /** The state of Arrivals each of these files is in (one missing from the map is in none). */
  statesOf(ids: readonly string[]): Map<string, ArrivalState> {
    const rows = this.database
      .prepare<[string], { id: string; state: ArrivalState | null }>(
        `SELECT id, CASE
           WHEN ${PRESENT_ENTRY} THEN 'present' WHEN ${READY_ENTRY} THEN 'ready'
           WHEN ${REVIEW_ENTRY} THEN 'review' WHEN ${UNRECOGNIZED_ENTRY} THEN 'unrecognized'
         END AS state FROM job_entries WHERE id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(ids));
    return new Map(rows.flatMap(({ id, state }) => (state === null ? [] : [[id, state] as const])));
  }

  /**
   * The files to set aside, as little as is needed to expand a release and tell what a transfer
   * holds: either these ids (open ones only) or everything of an Arrivals state.
   */
  seeds(
    target: { ids: readonly string[] } | { state: ArrivalState; arrivalIds: readonly string[] },
  ): EntrySeed[] {
    let where: string;
    const params: string[] = [];
    if ('ids' in target) {
      where = `id IN (SELECT value FROM json_each(?)) AND ${openEntry()}`;
      params.push(JSON.stringify(target.ids));
    } else {
      const marks = target.arrivalIds.map(() => '?').join(', ');
      where = `${STATES[target.state]} AND job_id IN (
        SELECT id FROM jobs WHERE library_id IS NULL${marks ? ` OR library_id IN (${marks})` : ''})`;
      params.push(...target.arrivalIds);
    }
    return this.database
      .prepare<string[], SeedRow>(
        `SELECT id, job_id, release, cluster,
                COALESCE(json_extract(parsed, '$.kind') = 'episode', 0) AS episode
         FROM job_entries WHERE ${where}`,
      )
      .all(...params)
      .map(seedOf);
  }

  /** The open episodes of the releases these files belong to: a release is settled as a whole. */
  withReleaseMates(seeds: readonly EntrySeed[]): EntrySeed[] {
    const known = new Map(seeds.map((seed) => [seed.id, seed]));
    const groups = new Set<string>();
    const mates = this.database.prepare<[string, string, number], SeedRow>(
      `SELECT id, job_id, release, cluster, 1 AS episode FROM job_entries
       WHERE job_id = ? AND release = ? AND cluster = ?
         AND resolution IS NULL AND classification <> 'compliant'
         AND json_extract(parsed, '$.kind') = 'episode'`,
    );
    for (const seed of seeds) {
      const key = `${seed.jobId}|${seed.release ?? ''}|${String(seed.cluster)}`;
      if (!seed.episode || seed.release === null || groups.has(key)) {
        continue;
      }
      groups.add(key);
      for (const row of mates.all(seed.jobId, seed.release, seed.cluster)) {
        known.set(row.id, known.get(row.id) ?? seedOf(row));
      }
    }
    return [...known.values()];
  }

  /** Sets these files aside, all in one write; returns how many were open. */
  ignoreAll(ids: readonly string[]): number {
    return this.database
      .prepare(
        `UPDATE job_entries SET resolution = 'ignored', batch_id = NULL, error = NULL
         WHERE id IN (SELECT value FROM json_each(?)) AND ${openEntry()}`,
      )
      .run(JSON.stringify(ids)).changes;
  }

  /** Files waiting in each state of Arrivals, for the badges. */
  arrivalCounts(arrivalIds: readonly string[]): Record<ArrivalState, number> {
    const marks = arrivalIds.map(() => '?').join(', ');
    const where = `job_id IN (
      SELECT id FROM jobs WHERE library_id IS NULL${marks ? ` OR library_id IN (${marks})` : ''})`;
    const counts = {} as Record<ArrivalState, number>;
    for (const [name, sql] of Object.entries(STATES) as [ArrivalState, string][]) {
      counts[name] =
        this.database
          .prepare<string[], { total: number }>(
            `SELECT COUNT(*) AS total FROM job_entries WHERE ${sql} AND ${where}`,
          )
          .get(...arrivalIds)?.total ?? 0;
    }
    return counts;
  }

  /** What the library holds of this file, or nothing; a new verdict replaces the owner's choice. */
  setDuplicate(
    id: string,
    duplicate: Duplicate | null,
    forced: 'asked' | 'confirmed' | null = null,
  ): void {
    this.database
      .prepare(
        `UPDATE job_entries SET duplicate_kind = ?, duplicate_path = ?, duplicate_library_id = ?,
           duplicate_size = ?, duplicate_forced = ? WHERE id = ?`,
      )
      .run(
        duplicate?.kind ?? null,
        duplicate?.path ?? null,
        duplicate?.libraryId ?? null,
        duplicate?.size ?? null,
        forced === 'asked' ? 1 : forced === 'confirmed' ? 2 : 0,
        id,
      );
  }

  /** The owner asked to process these files although the library holds them: back to review. */
  forceDuplicates(ids: readonly string[]): void {
    this.database
      .prepare(
        `UPDATE job_entries SET duplicate_forced = 1
         WHERE id IN (SELECT value FROM json_each(?)) AND duplicate_kind IS NOT NULL
           AND duplicate_forced = 0`,
      )
      .run(JSON.stringify(ids));
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

  /**
   * The episodes a validation of this one settles, itself included when it is open: the same
   * rule as `releaseMates`, read once for a whole release and series, not once per file. A page of
   * Arrivals asks for each of its files, which made a release of n files cost n reads of n rows.
   */
  releaseGroup(entry: Entry): Entry[] {
    if (entry.release === null || entry.parsed.kind !== 'episode') {
      return [];
    }
    return this.database
      .prepare<[string, string, number], EntryRow>(
        `SELECT ${COLUMNS} FROM job_entries
         WHERE job_id = ? AND release = ? AND cluster = ?
           AND resolution IS NULL AND classification != 'compliant'
         ORDER BY seq`,
      )
      .all(entry.jobId, entry.release, entry.cluster)
      .map(toEntry)
      .filter((other) => other.parsed.kind === 'episode');
  }

  /**
   * The release and series of each entry, and how many files a validation of it settles (itself and
   * its `releaseMates`), for the lists that group files the way Arrivals does.
   */
  releasesOf(
    ids: readonly string[],
  ): Map<string, { release: string | null; cluster: number; files: number }> {
    const found = new Map<string, { release: string | null; cluster: number; files: number }>();
    if (ids.length === 0) {
      return found;
    }
    const rows = this.database
      .prepare<string[], { id: string; release: string | null; cluster: number; files: number }>(
        `SELECT e.id, e.release, e.cluster,
                CASE WHEN e.release IS NULL THEN 1 ELSE (
                  SELECT COUNT(*) FROM job_entries o
                  WHERE o.job_id = e.job_id AND o.release = e.release AND o.cluster = e.cluster
                    AND o.resolution IS NULL AND o.classification != 'compliant') END AS files
         FROM job_entries e WHERE e.id IN (${ids.map(() => '?').join(', ')})`,
      )
      .all(...ids);
    for (const { id, release, cluster, files } of rows) {
      found.set(id, { release, cluster, files: Math.max(files, 1) });
    }
    return found;
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
           AND ${openEntry()} AND NOT ${PRESENT_ENTRY}
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
    /** The library the file is bound for, written in the same transaction. */
    destination?: { libraryId: string | null },
  ): void {
    this.database.transaction(() => {
      if (destination) {
        this.setDestination(id, destination.libraryId);
      }
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
          {
            ...compact(chosen, { kind: 'unknown', episodes: [], path: '' }),
            ...(kept && {
              score: kept.score,
              ...(kept.episodeUnknown && { episodeUnknown: true }),
              ...(kept.seasonUnknown && { seasonUnknown: true }),
              ...(kept.limits && { limits: kept.limits }),
            }),
          },
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
