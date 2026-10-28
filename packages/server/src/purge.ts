import type { Database } from 'better-sqlite3';

const DAY_MS = 86_400_000;

export interface PurgeResult {
  readonly jobs: number;
  readonly entries: number;
  readonly executions: number;
}

/**
 * A job nobody has anything left to do with: finished, no transfer pending, and no file that
 * still waits for a decision, a transfer, or a retry. Whatever is still open stays, however old:
 * that is the validation queue.
 */
const FORGOTTEN_JOBS = `
  SELECT j.id FROM jobs j
  WHERE j.status IN ('done', 'failed')
    AND COALESCE(j.finished_at, j.created_at) < ?
    AND NOT EXISTS (
      SELECT 1 FROM executions x
      WHERE x.job_id = j.id AND x.status IN ('queued', 'running')
    )
    AND NOT EXISTS (
      SELECT 1 FROM job_entries e
      WHERE e.job_id = j.id
        AND ((e.resolution IS NULL AND e.classification <> 'compliant') OR e.resolution = 'failed')
    )`;

/**
 * Forgets the history of finished jobs older than `olderThanDays`: the jobs, their files and
 * their transfers. The journal is not touched: any batch stays undoable. A non-positive number
 * keeps everything.
 */
export function purgeHistory(
  database: Database,
  options: { olderThanDays: number; now?: () => number },
): PurgeResult {
  const nothing: PurgeResult = { jobs: 0, entries: 0, executions: 0 };
  if (!(options.olderThanDays > 0)) {
    return nothing;
  }
  const cutoff = new Date(
    (options.now ?? Date.now)() - options.olderThanDays * DAY_MS,
  ).toISOString();

  return database.transaction((): PurgeResult => {
    const ids = database.prepare<[string], { id: string }>(FORGOTTEN_JOBS).all(cutoff);
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
  })();
}
