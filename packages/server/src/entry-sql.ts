/**
 * SQL fragments on `job_entries` that several queries must read the same way. `alias` is the
 * table's alias when the query gives one (`e`), empty otherwise.
 */
function column(alias: string, name: string): string {
  return alias ? `${alias}.${name}` : name;
}

/** Still to settle or to retry: no decision yet, or a transfer that failed. */
export function openEntry(alias = ''): string {
  const resolution = column(alias, 'resolution');
  return `(${resolution} IS NULL OR ${resolution} = 'failed')`;
}

/** Waiting for a human or a retry; what is already in order (`compliant`) waits for nothing. */
export function unsettledEntry(alias = ''): string {
  const resolution = column(alias, 'resolution');
  const classification = column(alias, 'classification');
  return `((${resolution} IS NULL AND ${classification} <> 'compliant') OR ${resolution} = 'failed')`;
}

/** What the validation queue lists as "review": a choice or a conflict, or a failed transfer. */
export const REVIEW_ENTRY =
  "((classification IN ('ambiguous', 'conflict') AND resolution IS NULL) OR resolution = 'failed')";

/**
 * What the validation queue lists as "ready": matched with confidence and planned, but not
 * transferred, because the job was an analysis only (`apply` off) and nothing queued it since. A
 * transfer waiting or running holds its files (`executions.entry_ids`, `NULL` for a whole job): they
 * are not offered again while it does, and come back as `failed` or `conflict` if it does not
 * succeed.
 */
export const READY_ENTRY = `(classification = 'to-rename' AND resolution IS NULL AND item IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM executions x
    WHERE x.job_id = job_entries.job_id AND x.status IN ('queued', 'running')
      AND (x.entry_ids IS NULL OR EXISTS (
        SELECT 1 FROM json_each(x.entry_ids) WHERE json_each.value = job_entries.id))))`;

/** What the validation queue lists as "unrecognized". */
export const UNRECOGNIZED_ENTRY = "(classification = 'unrecognized' AND resolution IS NULL)";
