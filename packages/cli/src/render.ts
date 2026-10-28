import { relative } from 'node:path';
import type {
  Analysis,
  AnalysisEntry,
  BatchResult,
  Classification,
  DestinationRoots,
  ErrorInfo,
  StaleFile,
  TransferMode,
  UndoResult,
} from '@kinoshelf/core';
import { describeError, type Translate } from './i18n/index.js';

const SECTIONS: readonly Classification[] = [
  'to-rename',
  'compliant',
  'conflict',
  'ambiguous',
  'unrecognized',
];

export interface RenderContext {
  readonly t: Translate;
  readonly profile: string;
  readonly mode: TransferMode;
}

const rootOf = (roots: DestinationRoots, kind: 'movie' | 'series'): string =>
  typeof roots === 'string' ? roots : roots[kind];

function destinationLine(analysis: Analysis, t: Translate): string {
  const roots = analysis.plan.destinationRoot;
  return typeof roots === 'string'
    ? t('report.destination', { destination: roots })
    : t('report.destinations', { movies: roots.movie, series: roots.series });
}

function describeEntry(entry: AnalysisEntry, analysis: Analysis, t: Translate): string[] {
  const lines = [`  ${entry.file.displayPath}`];
  const { outcome, item } = entry;

  switch (entry.classification) {
    case 'to-rename': {
      const main = item?.operations[0];
      if (outcome.status === 'matched' && main && 'destination' in main) {
        const root = rootOf(analysis.plan.destinationRoot, outcome.best.candidate.kind);
        const sidecars = item.operations.length - 1;
        lines.push(
          `    → ${relative(root, main.destination)}  (${t('entry.score', { score: outcome.best.score })})`,
        );
        if (sidecars > 0) {
          lines.push(`      ${t('entry.sidecars', { count: sidecars })}`);
        }
      }
      break;
    }
    case 'conflict':
      for (const conflict of item?.conflicts ?? []) {
        const detail = conflict.detail ? ` (${describeError(t, conflict.detail)})` : '';
        lines.push(`    ↳ ${t(`conflict.${conflict.reason}`)}${detail}`);
      }
      break;
    case 'ambiguous':
      if (outcome.status === 'ambiguous') {
        for (const { candidate, score } of outcome.candidates) {
          const params = { title: candidate.title, score, id: candidate.id.id };
          lines.push(
            candidate.year === undefined
              ? `    · ${t('entry.candidate-no-year', params)}`
              : `    · ${t('entry.candidate', { ...params, year: candidate.year })}`,
          );
        }
      }
      break;
    case 'unrecognized':
      if (outcome.status === 'unrecognized') {
        lines.push(`    ↳ ${t(`unrecognized.${outcome.reason}`)}`);
      }
      break;
    case 'compliant':
      break;
  }
  return lines;
}

export const countByClass = (analysis: Analysis): Record<Classification, number> => {
  const counts: Record<Classification, number> = {
    compliant: 0,
    'to-rename': 0,
    conflict: 0,
    ambiguous: 0,
    unrecognized: 0,
  };
  for (const entry of analysis.entries) {
    counts[entry.classification] += 1;
  }
  return counts;
};

/** The analysis as readable lines: what is where, and what each file would become. */
export function renderAnalysis(analysis: Analysis, context: RenderContext): string[] {
  const { t } = context;
  if (analysis.entries.length === 0) {
    return [t('report.none')];
  }

  const lines = [
    t('report.analyzed', {
      count: analysis.entries.length,
      profile: context.profile,
      mode: context.mode,
    }),
    destinationLine(analysis, t),
  ];
  for (const section of SECTIONS) {
    const entries = analysis.entries.filter((e) => e.classification === section);
    if (entries.length === 0) {
      continue;
    }
    lines.push('', `${t(`section.${section}`)} (${entries.length})`);
    for (const entry of entries) {
      lines.push(...describeEntry(entry, analysis, t));
    }
  }

  const counts = countByClass(analysis);
  lines.push(
    '',
    t('summary.line', {
      compliant: counts.compliant,
      toRename: counts['to-rename'],
      conflict: counts.conflict,
      ambiguous: counts.ambiguous,
      unrecognized: counts.unrecognized,
    }),
  );
  return lines;
}

/** What the executor did, operation by operation, and the batch totals. */
export function renderBatch(batch: BatchResult, t: Translate): { lines: string[]; failed: number } {
  const lines = [t('apply.header', { batch: batch.batchId })];
  const totals = { done: 0, skipped: 0, failed: 0 };

  for (const { results } of batch.items) {
    for (const { operation, status, error } of results) {
      totals[status] += 1;
      const target = 'destination' in operation ? operation.destination : '';
      if (status === 'done') {
        lines.push(`  ✓ ${target}`);
      } else if (error) {
        const reason = describeError(t, error);
        lines.push(`  ${status === 'failed' ? '✗' : '⚠'} ${target}`);
        lines.push(
          `      ${t(status === 'failed' ? 'result.failed' : 'result.skipped', { reason })}`,
        );
      }
    }
  }
  lines.push('', t('batch.summary', { batch: batch.batchId, ...totals }));
  if (totals.done > 0) {
    lines.push(t('batch.undo-hint', { batch: batch.batchId }));
  }
  return { lines, failed: totals.failed };
}

export function renderUndo(result: UndoResult, t: Translate): { lines: string[]; failed: number } {
  const lines = [t('undo.header', { batch: result.batchId })];
  const totals = { undone: 0, skipped: 0, failed: 0 };
  for (const { entry, status, error } of result.entries) {
    totals[status] += 1;
    if (status === 'undone') {
      lines.push(`  ✓ ${entry.destination}`);
    } else if (error) {
      lines.push(`  ${status === 'failed' ? '✗' : '⚠'} ${entry.destination}`);
      lines.push(
        `      ${t(status === 'failed' ? 'undo.failed' : 'undo.skipped', { reason: describeError(t, error) })}`,
      );
    }
  }
  lines.push('', t('undo.summary', totals));
  return { lines, failed: totals.failed };
}

const errorJson = (error: ErrorInfo | undefined) =>
  error ? { code: error.code, params: error.params } : undefined;

/** Language-neutral output for scripts: codes and parameters, never translated text. */
export function analysisToJson(analysis: Analysis, batch?: BatchResult) {
  return {
    dryRun: batch === undefined,
    summary: countByClass(analysis),
    entries: analysis.entries.map((entry) => {
      const best = entry.outcome.status === 'matched' ? entry.outcome.best : undefined;
      const main = entry.item?.operations[0];
      return {
        path: entry.file.path,
        classification: entry.classification,
        match: best && {
          provider: best.candidate.id.provider,
          id: best.candidate.id.id,
          kind: best.candidate.kind,
          title: best.candidate.title,
          year: best.candidate.year,
          score: best.score,
        },
        target: main && 'destination' in main ? main.destination : undefined,
        candidates:
          entry.outcome.status === 'ambiguous'
            ? entry.outcome.candidates.map((c) => ({
                id: c.candidate.id.id,
                kind: c.candidate.kind,
                title: c.candidate.title,
                year: c.candidate.year,
                score: c.score,
              }))
            : undefined,
        reason: entry.outcome.status === 'unrecognized' ? entry.outcome.reason : undefined,
        conflicts: entry.item?.conflicts.map((c) => ({
          reason: c.reason,
          path: c.path,
          detail: errorJson(c.detail),
        })),
      };
    }),
    batch: batch && {
      id: batch.batchId,
      items: batch.items.map((item) => ({
        itemId: item.itemId,
        results: item.results.map((r) => ({
          type: r.operation.type,
          destination: 'destination' in r.operation ? r.operation.destination : undefined,
          status: r.status,
          error: errorJson(r.error),
        })),
      })),
    },
  };
}

/** Binary units, which read the same in French and English (KiB, not KB or Ko). */
function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export function renderCleanup(
  files: readonly StaleFile[],
  context: { roots: readonly string[]; hours: number; dryRun: boolean },
  t: Translate,
): string[] {
  const lines = [t('cleanup.header', { hours: context.hours, folders: context.roots.join(', ') })];
  if (files.length === 0) {
    lines.push(t('cleanup.none'));
    return lines;
  }
  const totals = { removed: 0, failed: 0 };
  for (const file of files) {
    const mark = file.status === 'removed' ? '✓' : file.status === 'failed' ? '✗' : '·';
    lines.push(`  ${mark} ${file.path}`);
    lines.push(
      `      ${t('cleanup.file', { size: formatBytes(file.sizeBytes), age: Math.floor(file.ageHours) })}`,
    );
    if (file.status === 'removed') {
      totals.removed++;
    } else if (file.status === 'failed') {
      totals.failed++;
      lines.push(
        `      ${t('result.failed', { reason: describeError(t, file.error ?? { code: 'unknown' }) })}`,
      );
    }
  }
  lines.push('', t('cleanup.summary', { found: files.length, ...totals }));
  if (context.dryRun) {
    lines.push(t('cleanup.dry-run'));
  }
  return lines;
}

/** Codes and parameters, never translated text. */
export function cleanupToJson(
  roots: readonly string[],
  olderThanHours: number,
  dryRun: boolean,
  files: readonly StaleFile[],
): unknown {
  return { roots, olderThanHours, dryRun, files };
}
