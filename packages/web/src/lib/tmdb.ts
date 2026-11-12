import type { paths } from './api-schema.js';

type Usage = paths['/api/tmdb/usage']['get']['responses'][200]['content']['application/json'];

export type UsagePeriod = Usage['period'];
export type UsageCounts = Usage['totals'];
export type UsageKind = Usage['kinds'][number]['kind'];
export type UsageSlot = Usage['slots'][number];
export type UsageError = Usage['recentErrors'][number];
export type UsageReport = Usage;

export const USAGE_PERIODS: readonly UsagePeriod[] = ['24h', '7d', '30d'];

// The server's list, held by the type: a kind added there breaks the build here.
const KIND_LIST = {
  search: true,
  movie: true,
  series: true,
  collection: true,
  season: true,
  images: true,
  titles: true,
} satisfies Record<UsageKind, true>;
export const USAGE_KINDS = Object.keys(KIND_LIST) as UsageKind[];

/** Failed requests, whatever the cause. */
export const errorsOf = (c: UsageCounts): number =>
  c.rateLimited + c.serverError + c.unreachable + c.refused;

/** Requests Kinoshelf sent: the ones that came back and the ones that failed. */
export const sentOf = (c: UsageCounts): number => c.network + errorsOf(c);

/** Share of the calls the cache answered (0 to 100), `null` before any call. */
export function hitRate(c: UsageCounts): number | null {
  const calls = c.cache + c.network;
  return calls === 0 ? null : Math.round((c.cache / calls) * 100);
}

/** A recent 429 or refusal: what makes the page warn. */
const RECENT_MS = 15 * 60_000;
export function recentError(
  errors: readonly UsageError[],
  outcome: UsageError['outcome'],
  now: number,
): boolean {
  return errors.some((e) => e.outcome === outcome && now - Date.parse(e.at) < RECENT_MS);
}

/** Height of the tallest bar, so every bar is drawn against the same scale. */
export const tallest = (slots: readonly UsageSlot[]): number =>
  Math.max(1, ...slots.map((s) => s.network + s.cache + s.errors));
