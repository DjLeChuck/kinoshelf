import type { Database } from '@kinoshelf/core';
import { unsettledEntry } from './entry-sql.js';

const DAY_MS = 86_400_000;

export interface PurgeResult {
  readonly jobs: number;
  readonly entries: number;
  readonly executions: number;
}

/** A typed library's whole source: what its scans are jobs on. */
export interface LibraryScan {
  readonly libraryId: string;
  readonly source: string;
}

/**
 * A scan of a typed library's whole source that a later one replaced: the snapshot was rebuilt
 * from the newer scan, so nothing points at its files any more, not even those nobody decided on
 * (they are in the newer scan too). Without this, every rescan of a library holding one
 * unrecognized file would be kept for good, tens of thousands of rows each time.
 */
const SUPERSEDED = `
  j.library_id IS NOT NULL
  AND j.status IN ('done', 'failed')
  AND EXISTS (
    SELECT 1 FROM jobs k
    WHERE k.library_id = j.library_id AND k.path = j.path AND k.status = 'done' AND k.seq > j.seq
  )
  AND NOT EXISTS (SELECT 1 FROM library_items i WHERE i.scan_job_id = j.id)`;

const WITHOUT_PENDING_TRANSFER = `
  NOT EXISTS (
    SELECT 1 FROM executions x
    WHERE x.job_id = j.id AND x.status IN ('queued', 'running')
  )`;

/**
 * A job nobody has anything left to do with: finished, no transfer pending, and no file that
 * still waits for a decision, a transfer, or a retry. Whatever is still open stays, however old:
 * that is the validation queue. A replaced scan is not that queue any more.
 */
const FORGOTTEN_JOBS = `
  SELECT j.id FROM jobs j
  WHERE j.status IN ('done', 'failed')
    AND COALESCE(j.finished_at, j.created_at) < ?
    AND ${WITHOUT_PENDING_TRANSFER}
    AND (
      NOT EXISTS (
        SELECT 1 FROM job_entries e
        WHERE e.job_id = j.id
          AND ${unsettledEntry('e')}
      )
      OR (${SUPERSEDED} AND j.path = (SELECT value FROM json_each(?) WHERE key = j.library_id))
    )`;

/**
 * A replaced scan that never transferred anything, whatever its age: the history only lists it
 * under "Show every analysis", and it made no batch whose detail would lose it.
 */
const REPLACED_SCANS = `
  SELECT j.id FROM jobs j
  WHERE ${SUPERSEDED}
    AND j.path = (SELECT value FROM json_each(?) WHERE key = j.library_id)
    AND NOT EXISTS (SELECT 1 FROM executions x WHERE x.job_id = j.id)`;

/** The sources of the typed libraries, by id, as `json_each` reads them. */
const sourcesOf = (scans: readonly LibraryScan[]): string =>
  JSON.stringify(Object.fromEntries(scans.map(({ libraryId, source }) => [libraryId, source])));

function forget(database: Database, ids: readonly { id: string }[]): PurgeResult {
  const entries = database.prepare('DELETE FROM job_entries WHERE job_id = ?');
  const executions = database.prepare('DELETE FROM executions WHERE job_id = ?');
  const jobs = database.prepare('DELETE FROM jobs WHERE id = ?');
  const result = { jobs: 0, entries: 0, executions: 0 };
  for (const { id } of ids) {
    result.entries += entries.run(id).changes;
    result.executions += executions.run(id).changes;
    result.jobs += jobs.run(id).changes;
  }
  return result;
}

/**
 * Forgets the history of finished jobs older than `olderThanDays`: the jobs, their files and
 * their transfers. The journal is not touched: any batch stays undoable. A non-positive number
 * keeps everything. `scans` are the typed libraries, whose replaced scans are forgotten even
 * with files nobody decided on.
 */
export function purgeHistory(
  database: Database,
  options: { olderThanDays: number; now?: () => number; scans?: readonly LibraryScan[] },
): PurgeResult {
  const nothing: PurgeResult = { jobs: 0, entries: 0, executions: 0 };
  if (!(options.olderThanDays > 0)) {
    return nothing;
  }
  const cutoff = new Date(
    (options.now ?? Date.now)() - options.olderThanDays * DAY_MS,
  ).toISOString();
  const sources = sourcesOf(options.scans ?? []);

  return database.transaction(() =>
    forget(
      database,
      database.prepare<[string, string], { id: string }>(FORGOTTEN_JOBS).all(cutoff, sources),
    ),
  )();
}

/**
 * Forgets at once the scans of typed libraries that a later scan replaced, when they made no
 * transfer: a library rescanned every day would otherwise keep a full copy of itself per day
 * until the retention ends. Those that made a batch wait for `purgeHistory`, so the batch's detail
 * keeps its job meanwhile.
 */
export function forgetReplacedScans(
  database: Database,
  scans: readonly LibraryScan[],
): PurgeResult {
  if (scans.length === 0) {
    return { jobs: 0, entries: 0, executions: 0 };
  }
  return database.transaction(() =>
    forget(
      database,
      database.prepare<[string], { id: string }>(REPLACED_SCANS).all(sourcesOf(scans)),
    ),
  )();
}
