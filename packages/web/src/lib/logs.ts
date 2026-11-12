import type { Locale } from '@kinoshelf/i18n';
import type { paths } from './api-schema.js';

type Query = NonNullable<paths['/api/logs']['get']['parameters']['query']>;

export type LogLevel = NonNullable<Query['level']>;
export type LogComponent = NonNullable<Query['component']>;

/** One line of `GET /api/logs`. */
export interface LogEntry {
  readonly seq: number;
  readonly time: string;
  readonly level: LogLevel;
  readonly component: LogComponent;
  readonly message: string;
  readonly job: string | null;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface LogPage {
  readonly entries: readonly LogEntry[];
  readonly newer: number;
  readonly kept: number;
  readonly since: string | null;
  readonly fileBytes: number;
  readonly level: LogLevel;
}

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

// The server's list, held by the type: a component added there breaks the build here.
const COMPONENT_LIST = {
  server: true,
  http: true,
  scan: true,
  transfer: true,
  watcher: true,
  tmdb: true,
  notify: true,
} satisfies Record<LogComponent, true>;
export const LOG_COMPONENTS = Object.keys(COMPONENT_LIST) as LogComponent[];

/** What the level filter keeps: this level and above (`all` includes `debug`, if it is recorded). */
export const LEVEL_FILTERS = ['all', 'info', 'warn', 'error'] as const;
export type LevelFilter = (typeof LEVEL_FILTERS)[number];

export const PERIODS = ['15m', '1h', '24h', 'all'] as const;
export type Period = (typeof PERIODS)[number];

const MINUTES: Record<Period, number | undefined> = {
  '15m': 15,
  '1h': 60,
  '24h': 1440,
  all: undefined,
};

/** What the filters of the page hold; the URL carries the non-default ones. */
export interface LogFilters {
  readonly level: LevelFilter;
  readonly component: LogComponent | undefined;
  readonly q: string;
  readonly period: Period;
}

export const NO_FILTERS: LogFilters = {
  level: 'all',
  component: undefined,
  q: '',
  period: 'all',
};

export const LOG_LIMIT = 500;

/** The query string of `GET /api/logs` for these filters. */
export function logsQuery(
  filters: LogFilters,
  extra: { limit?: number; after?: number } = {},
): string {
  const params = new URLSearchParams();
  if (filters.level !== 'all') {
    params.set('level', filters.level);
  }
  if (filters.component) {
    params.set('component', filters.component);
  }
  const q = filters.q.trim();
  if (q !== '') {
    params.set('q', q);
  }
  const minutes = MINUTES[filters.period];
  if (minutes !== undefined) {
    params.set('minutes', String(minutes));
  }
  params.set('limit', String(extra.limit ?? LOG_LIMIT));
  if (extra.after !== undefined) {
    params.set('after', String(extra.after));
  }
  return `?${params.toString()}`;
}

export function isFiltered(filters: LogFilters): boolean {
  return (
    filters.level !== 'all' ||
    filters.component !== undefined ||
    filters.q.trim() !== '' ||
    filters.period !== 'all'
  );
}

export const LEVEL_CHIP: Record<LogLevel, string> = {
  debug: 'chip-neutral',
  info: 'chip-info',
  warn: 'chip-warn',
  error: 'chip-danger',
};

/**
 * The time of a line: the clock for today's, the day too for an older one (a log reaches back
 * days), both in the browser's zone. The full instant is the line's tooltip (`formatFull`).
 */
export function formatLogTime(iso: string, locale: Locale, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(locale, {
    ...(!sameDay && { day: '2-digit', month: '2-digit' }),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

/** The full instant, to the millisecond: the tooltip of a line, whose clock only shows seconds. */
export function formatFull(iso: string, locale: Locale): string {
  const date = new Date(iso);
  // `dateStyle`/`timeStyle` cannot be mixed with the milliseconds: the fields are named instead.
  return Number.isNaN(date.getTime())
    ? iso
    : new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
        hour12: false,
      }).format(date);
}

/** The detail of a line, as it is copied: its fields, readable. */
export function detailOf(entry: LogEntry): string {
  return JSON.stringify(
    {
      time: entry.time,
      level: entry.level,
      component: entry.component,
      message: entry.message,
      ...(entry.job !== null && { job: entry.job }),
      ...entry.data,
    },
    null,
    2,
  );
}
