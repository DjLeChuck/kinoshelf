import type { ScanRow } from './libraries.js';

/** Rows start all selected: the selection is kept as what the user took out. */
export type Deselected = ReadonlySet<string>;

export const isSelected = (off: Deselected, id: string): boolean => !off.has(id);

export function toggleRow(off: Deselected, id: string): Deselected {
  const next = new Set(off);
  if (!next.delete(id)) {
    next.add(id);
  }
  return next;
}

/** Select all, or none when everything is already selected. */
export function toggleAll(off: Deselected, rows: readonly ScanRow[]): Deselected {
  const all = rows.every((row) => !off.has(row.id));
  return all ? new Set(rows.map((row) => row.id)) : new Set();
}

export const selectedIds = (rows: readonly ScanRow[], off: Deselected): string[] =>
  rows.filter((row) => !off.has(row.id)).map((row) => row.id);

/** A score is shown as a percentage unless it carries no information (certain, or none). */
export const scoreLabel = (score: number | null): string | undefined =>
  score === null || score <= 0 || score >= 100 ? undefined : `${Math.round(score)} %`;

/** Green when automatic, amber when borderline, grey otherwise (the mock-up's thresholds). */
export const scoreTone = (score: number | null): 'ok' | 'warn' | 'muted' =>
  score !== null && score >= 85 ? 'ok' : score !== null && score >= 40 ? 'warn' : 'muted';
