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

// NULL is the normal value of `duplicate_kind`, and `NOT NULL` is NULL, not true: every test of it
// is wrapped so that a file with no verdict is plainly "not a duplicate".

/**
 * A file the destination library holds for certain (`same-file`, `same-size`) and the owner did not
 * ask to process (`duplicate_forced` 0).
 */
const CERTAIN_DUPLICATE = (alias: string): string =>
  `COALESCE(${alias}duplicate_kind IN ('same-file', 'same-size') AND ${alias}duplicate_forced = 0, 0)`;

/**
 * What the validation queue lists as "present": still open, certainly in the library already. An
 * episode counts only when every other open episode of its release and series is too: a release
 * with some episodes to bring in stays what it was (the panel lists the ones already there), since
 * a release is validated and transferred as a whole.
 */
export const PRESENT_ENTRY = `(resolution IS NULL AND ${CERTAIN_DUPLICATE('')}
  AND (json_extract(parsed, '$.kind') <> 'episode' OR release IS NULL OR NOT EXISTS (
    SELECT 1 FROM job_entries o
    WHERE o.job_id = job_entries.job_id AND o.release = job_entries.release
      AND o.cluster = job_entries.cluster AND o.id <> job_entries.id
      AND o.resolution IS NULL AND o.classification <> 'compliant'
      AND json_extract(o.parsed, '$.kind') = 'episode'
      AND NOT ${CERTAIN_DUPLICATE('o.')})))`;

/**
 * The work is in the library in a version we cannot tell is the same (`other-version`), or the owner
 * asked to process a file it holds (`duplicate_forced` 1): a human decides. Validating it confirms
 * (`duplicate_forced` 2) and it goes out like any other.
 */
const ASKS_A_HUMAN = `(COALESCE(duplicate_kind = 'other-version' AND duplicate_forced <> 2, 0) OR duplicate_forced = 1)`;

/** What the validation queue lists as "review": a choice or a conflict, or a failed transfer. */
export const REVIEW_ENTRY = `(
  (classification IN ('ambiguous', 'conflict') AND resolution IS NULL AND NOT ${PRESENT_ENTRY})
  OR resolution = 'failed'
  OR (classification = 'to-rename' AND resolution IS NULL AND item IS NOT NULL AND ${ASKS_A_HUMAN}))`;

/**
 * What the validation queue lists as "ready": matched with confidence and planned, but not
 * transferred, because the job was an analysis only (`apply` off) and nothing queued it since, and
 * not already in the library. A transfer waiting or running holds its files (`executions.entry_ids`,
 * `NULL` for a whole job): they are not offered again while it does, and come back as `failed` or
 * `conflict` if it does not succeed.
 */
export const READY_ENTRY = `(classification = 'to-rename' AND resolution IS NULL AND item IS NOT NULL
  AND NOT ${ASKS_A_HUMAN} AND NOT ${PRESENT_ENTRY}
  AND NOT EXISTS (
    SELECT 1 FROM executions x
    WHERE x.job_id = job_entries.job_id AND x.status IN ('queued', 'running')
      AND (x.entry_ids IS NULL OR EXISTS (
        SELECT 1 FROM json_each(x.entry_ids) WHERE json_each.value = job_entries.id))))`;

/** What the validation queue lists as "unrecognized". */
export const UNRECOGNIZED_ENTRY = "(classification = 'unrecognized' AND resolution IS NULL)";
