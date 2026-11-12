/** The kinds of call Kinoshelf makes to TMDB, told apart by the path asked. */
export const TMDB_CALL_KINDS = [
  'search',
  'movie',
  'series',
  'collection',
  'season',
  'images',
  'titles',
] as const;
export type TmdbCallKind = (typeof TMDB_CALL_KINDS)[number];

/**
 * What became of one call: answered by the cache, or one request sent to TMDB that came back
 * (`network`, a 404 included) or did not. A request retried is counted each time it is sent,
 * which is what TMDB's rate limit counts too.
 */
export const TMDB_OUTCOMES = [
  'cache',
  'network',
  'rate-limited',
  'server-error',
  'unreachable',
  'refused',
] as const;
export type TmdbOutcome = (typeof TMDB_OUTCOMES)[number];

export interface TmdbUsageEvent {
  readonly kind: TmdbCallKind;
  readonly outcome: TmdbOutcome;
  /** How long a request that came back took. */
  readonly ms?: number;
  readonly path: string;
  readonly status?: number;
  /** Requests already sent for this call, this one excluded. */
  readonly attempt: number;
  /** No further attempt follows: the call is given up. */
  readonly final: boolean;
}

/**
 * Where the client reports what it sent. Injected, so the provider depends on nothing of the
 * server; a sink that throws is ignored, counting never breaks a request.
 */
export interface UsageSink {
  record(event: TmdbUsageEvent): void;
}

/** Which kind of call a TMDB path is (`/3/tv/1/season/2` is a season, `/3/tv/1/images` images). */
export function callKindOf(path: string): TmdbCallKind {
  if (path.startsWith('/3/search/')) {
    return 'search';
  }
  if (path.endsWith('/images')) {
    return 'images';
  }
  if (path.endsWith('/alternative_titles')) {
    return 'titles';
  }
  if (path.startsWith('/3/collection/')) {
    return 'collection';
  }
  if (path.includes('/season/')) {
    return 'season';
  }
  return path.startsWith('/3/tv/') ? 'series' : 'movie';
}
