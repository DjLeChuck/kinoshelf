import { basename, relative } from 'node:path';
import type {
  Analysis,
  AnalysisEntry,
  BatchResult,
  Classification,
  DestinationRoots,
  ErrorInfo,
  PlanItem,
  LeftBehind,
  StaleFile,
  TidiedSubtitle,
  TidiedFolder,
  TidiedForeignFile,
  TidyReport,
  TransferMode,
  UndoResult,
} from '@kinoshelf/core';
import { describeError, formatBytes, type Translate } from '@kinoshelf/i18n';

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

const rootOf = (roots: DestinationRoots, kind: 'movie' | 'series'): string | undefined =>
  typeof roots === 'string' ? roots : roots[kind];

function destinationLine(analysis: Analysis, t: Translate): string {
  const roots = analysis.plan.destinationRoot;
  return typeof roots === 'string'
    ? t('report.destination', { destination: roots })
    : t('report.destinations', { movies: roots.movie ?? '—', series: roots.series ?? '—' });
}

/** The subtitles of a `Subs` folder that stay where they are, one line each with its reason. */
const leftBehindLines = (item: PlanItem, t: Translate): string[] =>
  (item.leftBehind ?? []).map(
    ({ path, reason }) =>
      `      ↳ ${t('entry.left-behind', { file: basename(path), reason: t(`left-behind.${reason}`) })}`,
  );

function describeEntry(entry: AnalysisEntry, analysis: Analysis, t: Translate): string[] {
  const lines = [`  ${entry.file.displayPath}`];
  const { outcome, item } = entry;

  switch (entry.classification) {
    case 'to-rename': {
      const main = item?.operations[0];
      if (!item || outcome.status !== 'matched') {
        break;
      }
      if (main?.type === 'transfer') {
        const root = rootOf(analysis.plan.destinationRoot, outcome.best.candidate.kind);
        const sidecars = item.operations.length - 1;
        lines.push(
          `    → ${root === undefined ? main.destination : relative(root, main.destination)}  (${t('entry.score', { score: outcome.best.score })})`,
        );
        if (sidecars > 0) {
          lines.push(`      ${t('entry.sidecars', { count: sidecars })}`);
        }
        lines.push(...leftBehindLines(item, t));
      } else {
        // Already where the profile wants it: only what goes beside it is missing.
        lines.push(
          `    = ${t('entry.in-place')}  (${t('entry.score', { score: outcome.best.score })})`,
          `      ${t('entry.sidecars', { count: item.operations.length })}`,
        );
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
      const where = 'destination' in operation ? operation.destination : '';
      // Only what is not the video or its sidecars needs saying: an NFO or an image.
      const target =
        operation.type === 'transfer' ? where : `[${t(`operation.${operation.type}`)}] ${where}`;
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
        `      ${t(status === 'failed' ? 'result.failed' : 'result.skipped', { reason: describeError(t, error) })}`,
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
        target: main?.type === 'transfer' ? main.destination : undefined,
        leftBehind: entry.item?.leftBehind?.map(({ path, reason }) => ({ path, reason })),
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

export function renderTidy(reports: readonly TidyReport[], t: Translate): string[] {
  const lines: string[] = [];
  const totals = { orphans: 0, foreign: 0 };
  for (const { library, orphanFolders, foreignFiles } of reports) {
    lines.push(t('tidy.header', { name: library.id, type: library.type, source: library.source }));
    totals.orphans += orphanFolders.length;
    totals.foreign += foreignFiles.length;
    if (orphanFolders.length === 0 && foreignFiles.length === 0) {
      lines.push(`  ${t('tidy.clean')}`, '');
      continue;
    }
    if (orphanFolders.length > 0) {
      lines.push(`  ${t('tidy.orphans', { count: orphanFolders.length })}`);
      for (const folder of orphanFolders) {
        lines.push(`    · ${folder.path}`);
        lines.push(
          `        ${
            folder.files === 0
              ? t('tidy.orphan.empty')
              : t('tidy.orphan', { files: folder.files, size: formatBytes(folder.sizeBytes) })
          }`,
        );
        for (const entry of folder.entries) {
          lines.push(`          ${entry}`);
        }
        if (folder.entries.length < folder.files) {
          lines.push(`          …`);
        }
        if (folder.otherFiles > 0) {
          lines.push(`        ! ${t('tidy.orphan.other', { count: folder.otherFiles })}`);
        }
      }
    }
    if (foreignFiles.length > 0) {
      lines.push(`  ${t('tidy.foreign', { count: foreignFiles.length })}`);
      for (const file of foreignFiles) {
        lines.push(`    · ${file.path}`);
        lines.push(
          `        ${t(
            file.counterpartPresent ? 'tidy.foreign.file.present' : 'tidy.foreign.file.missing',
            {
              size: formatBytes(file.sizeBytes),
              counterpart: file.counterpart,
            },
          )}`,
        );
      }
    }
    lines.push('');
  }
  lines.push(t('tidy.summary', totals), t('tidy.read-only'));
  return lines;
}

/** Codes and parameters, never translated text. */
export function tidyToJson(reports: readonly TidyReport[]): unknown {
  return { readOnly: true, libraries: reports };
}

export interface TidyFoldersRun {
  readonly library: { readonly id: string };
  readonly folders: readonly TidiedFolder[];
}

export function renderTidyFolders(
  runs: readonly TidyFoldersRun[],
  batches: ReadonlyMap<string, string | null>,
  options: { dryRun: boolean; backupDir: string },
  t: Translate,
): { lines: string[]; failed: number } {
  const lines: string[] = [];
  const count = { removed: 0, skipped: 0, failed: 0 };
  for (const { library, folders } of runs) {
    lines.push(t('tidy.folders.header', { name: library.id }));
    if (folders.length === 0) {
      lines.push(`  ${t('tidy.folders.none')}`);
    }
    for (const folder of folders) {
      lines.push(`    · ${folder.path}`);
      if (folder.status === 'skipped') {
        count.skipped++;
        lines.push(`        ${t(`tidy.folders.skipped.${folder.reason ?? 'changed'}`)}`);
      } else if (folder.status === 'failed') {
        count.failed++;
        lines.push(`        ${t('tidy.folders.failed', { moved: folder.moved ?? 0 })}`);
        if (folder.error) {
          lines.push(`        ${describeError(t, folder.error)}`);
        }
      } else {
        count.removed++;
        lines.push(
          `        ${t(
            `tidy.folders.${folder.status === 'removed' ? 'removed' : 'would-remove'}${folder.empty ? '-empty' : ''}`,
            {
              files: folder.files,
              twin: basename(folder.twin ?? ''),
            },
          )}`,
        );
        if (folder.approximate) {
          lines.push(`        ! ${t('tidy.folders.approximate')}`);
        }
      }
    }
    const batch = batches.get(library.id);
    if (batch) {
      lines.push(`  ${t('tidy.folders.batch', { batch, backup: options.backupDir })}`);
    }
    lines.push('');
  }
  lines.push(t(options.dryRun ? 'tidy.folders.summary.dry-run' : 'tidy.folders.summary', count));
  if (options.dryRun) {
    lines.push(t('tidy.folders.dry-run'));
  }
  return { lines, failed: count.failed };
}

/** Codes and parameters, never translated text. */
export function tidyFoldersToJson(
  runs: readonly (TidyFoldersRun & { readonly batchId: string | null })[],
  dryRun: boolean,
): unknown {
  return {
    dryRun,
    libraries: runs.map(({ library, batchId, folders }) => ({ id: library.id, batchId, folders })),
  };
}

export interface TidyFilesRun {
  readonly library: { readonly id: string };
  readonly files: readonly TidiedForeignFile[];
}

export function renderTidyFiles(
  runs: readonly TidyFilesRun[],
  batches: ReadonlyMap<string, string | null>,
  options: { dryRun: boolean; backupDir: string },
  t: Translate,
): { lines: string[]; failed: number } {
  const lines: string[] = [];
  const count = { renamed: 0, removed: 0, skipped: 0, failed: 0 };
  for (const { library, files } of runs) {
    lines.push(t('tidy.files.header', { name: library.id }));
    if (files.length === 0) {
      lines.push(`  ${t('tidy.files.none')}`);
    }
    for (const file of files) {
      lines.push(`    · ${file.path}`);
      if (file.status === 'skipped') {
        count.skipped++;
        lines.push(`        ${t(`tidy.files.skipped.${file.reason ?? 'changed'}`)}`);
      } else if (file.status === 'failed') {
        count.failed++;
        if (file.error) {
          lines.push(`        ${describeError(t, file.error)}`);
        }
      } else {
        count[file.action === 'rename' ? 'renamed' : 'removed']++;
        lines.push(
          `        ${t(`tidy.files.${file.action ?? 'remove'}.${file.status}`, { counterpart: file.counterpart })}`,
        );
      }
    }
    const batch = batches.get(library.id);
    if (batch) {
      lines.push(`  ${t('tidy.folders.batch', { batch, backup: options.backupDir })}`);
    }
    lines.push('');
  }
  lines.push(t(options.dryRun ? 'tidy.files.summary.dry-run' : 'tidy.files.summary', count));
  if (options.dryRun) {
    lines.push(t('tidy.files.dry-run'));
  }
  return { lines, failed: count.failed };
}

export interface TidySubtitlesRun {
  readonly library: { readonly id: string };
  readonly files: readonly TidiedSubtitle[];
  readonly left: readonly LeftBehind[];
}

export function renderTidySubtitles(
  runs: readonly TidySubtitlesRun[],
  batches: ReadonlyMap<string, string | null>,
  options: { dryRun: boolean },
  t: Translate,
): { lines: string[]; failed: number } {
  const lines: string[] = [];
  const count = { moved: 0, skipped: 0, left: 0, failed: 0 };
  for (const { library, files, left } of runs) {
    lines.push(t('tidy.subtitles.header', { name: library.id }));
    if (files.length === 0 && left.length === 0) {
      lines.push(`  ${t('tidy.subtitles.none')}`);
    }
    for (const file of files) {
      lines.push(`    · ${file.path}`);
      if (file.status === 'skipped') {
        count.skipped++;
        lines.push(
          `        ${t(`tidy.subtitles.skipped.${file.reason ?? 'changed'}`, { destination: basename(file.destination) })}`,
        );
      } else if (file.status === 'failed') {
        count.failed++;
        if (file.error) {
          lines.push(`        ${describeError(t, file.error)}`);
        }
      } else {
        count.moved++;
        lines.push(
          `        ${t(`tidy.subtitles.${file.status}`, { destination: basename(file.destination) })}`,
        );
      }
    }
    for (const { path, reason } of left) {
      count.left++;
      lines.push(
        `    · ${path}`,
        `        ${t('tidy.subtitles.left', { reason: t(`left-behind.${reason}`) })}`,
      );
    }
    const batch = batches.get(library.id);
    if (batch) {
      lines.push(`  ${t('tidy.subtitles.batch', { batch })}`);
    }
    lines.push('');
  }
  lines.push(
    t(options.dryRun ? 'tidy.subtitles.summary.dry-run' : 'tidy.subtitles.summary', count),
  );
  if (options.dryRun) {
    lines.push(t('tidy.subtitles.dry-run'));
  }
  return { lines, failed: count.failed };
}

/** Codes and parameters, never translated text. */
export function tidySubtitlesToJson(
  runs: readonly (TidySubtitlesRun & { readonly batchId: string | null })[],
  dryRun: boolean,
): unknown {
  return {
    dryRun,
    libraries: runs.map(({ library, batchId, files, left }) => ({
      id: library.id,
      batchId,
      files,
      left,
    })),
  };
}

/** Codes and parameters, never translated text. */
export function tidyFilesToJson(
  runs: readonly (TidyFilesRun & { readonly batchId: string | null })[],
  dryRun: boolean,
): unknown {
  return {
    dryRun,
    libraries: runs.map(({ library, batchId, files }) => ({ id: library.id, batchId, files })),
  };
}
