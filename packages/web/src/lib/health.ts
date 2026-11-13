import type { MessageKey } from '@kinoshelf/i18n';
import type { paths } from './api-schema.js';
import type { WatchStatus } from './watch.js';

export type HealthReport =
  paths['/api/health/report']['get']['responses'][200]['content']['application/json'];
export type HealthProblem = HealthReport['problems'][number];
export type Delivery = HealthReport['notify']['recent'][number];

export type CardId =
  'server' | 'ffprobe' | 'database' | 'disk' | 'queue' | 'watch' | 'media' | 'webhooks';

/** In the order of the page. */
export const CARDS: readonly CardId[] = [
  'server',
  'ffprobe',
  'database',
  'disk',
  'queue',
  'watch',
  'media',
  'webhooks',
] as const;

/** `off` is a card for something nobody asked for: neither good nor wrong. */
export type CardState = 'ok' | 'warn' | 'danger' | 'off';

/** The settings section that fixes a card, when there is one. */
export const SETTINGS_SECTION: Partial<Record<CardId, string>> = {
  disk: 'libraries',
  watch: 'watch',
  ffprobe: 'processing',
  media: 'plex',
  webhooks: 'webhooks',
};

/** Texts of the codes the server knows; a newer server's unknown code gets the generic one. */
const PROBLEM_TEXT: Record<string, MessageKey> = {
  'database-unreadable': 'web.health.problem.database-unreadable',
  'library-unreachable': 'web.health.problem.library-unreachable',
  'watch-folder-unreachable': 'web.health.problem.watch-folder-unreachable',
  'plex-signed-out': 'web.health.problem.plex-signed-out',
  'ffprobe-missing': 'web.health.problem.ffprobe-missing',
  'disk-low': 'web.health.problem.disk-low',
  'webhook-failing': 'web.health.problem.webhook-failing',
  'media-refresh-failed': 'web.health.problem.media-refresh-failed',
};

export const problemText = (problem: HealthProblem): MessageKey =>
  PROBLEM_TEXT[problem.code] ?? 'web.health.problem.unknown';

export const problemsOf = (report: HealthReport, area: CardId): HealthProblem[] =>
  report.problems.filter((problem) => problem.area === area);

export function stateOf(
  id: CardId,
  report: HealthReport,
  watch: WatchStatus | undefined,
): CardState {
  const problems = problemsOf(report, id);
  if (problems.some((problem) => problem.severity === 'error')) {
    return 'danger';
  }
  if (problems.length > 0) {
    return 'warn';
  }
  switch (id) {
    case 'watch':
      return watch?.enabled === false ? 'off' : 'ok';
    case 'media':
      return report.notify.plex || report.notify.jellyfin ? 'ok' : 'off';
    case 'webhooks':
      return report.notify.webhooks > 0 ? 'ok' : 'off';
    default:
      return 'ok';
  }
}

/** The worst of the cards, for the summary above them. */
export function worst(states: readonly CardState[]): 'ok' | 'warn' | 'danger' {
  return states.includes('danger') ? 'danger' : states.includes('warn') ? 'warn' : 'ok';
}

/** Free share of a disk, `null` when unknown. */
export const freeShare = (disk: HealthReport['disks'][number]): number | null =>
  disk.totalBytes !== null && disk.freeBytes !== null && disk.totalBytes > 0
    ? disk.freeBytes / disk.totalBytes
    : null;

/** Whole days, hours and minutes of an uptime; the largest two are shown. */
export function uptimeParts(seconds: number): { days: number; hours: number; minutes: number } {
  return {
    days: Math.floor(seconds / 86_400),
    hours: Math.floor((seconds % 86_400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
  };
}
