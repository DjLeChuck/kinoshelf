import { api } from './api.js';
import type { Library } from './libraries.js';

export type ItemState = 'review' | 'rename' | 'unrecognized' | 'incomplete' | 'ok';
export type ItemFilter = 'review' | 'rename' | 'unrecognized' | 'missing-nfo' | 'missing-artwork';
export const ITEM_FILTERS: readonly ItemFilter[] = [
  'review',
  'rename',
  'unrecognized',
  'missing-nfo',
  'missing-artwork',
];
/** A series library also filters its shows (`missing-episodes` counts shows, not files). */
export type ShowFilter = ItemFilter | 'missing-episodes';
export const SERIES_FILTERS: readonly ShowFilter[] = [...ITEM_FILTERS, 'missing-episodes'];
export type Counts = Readonly<Record<ShowFilter | 'all', number>>;

/** What a library holds, as `GET /api/libraries/{id}/items` lists it. */
export interface LibraryItem {
  readonly id: string;
  readonly path: string;
  readonly state: ItemState;
  readonly kind: 'movie' | 'series' | null;
  readonly title: string | null;
  readonly year: number | null;
  readonly tmdbId: number | null;
  /** Series only; `episodeEnd` is the last episode of a file holding several. */
  readonly season: number | null;
  readonly episode: number | null;
  readonly episodeEnd: number | null;
  readonly resolution: string | null;
  /** `null`: the profile writes none, or it cannot be told. */
  readonly nfo: boolean | null;
  readonly poster: boolean | null;
  readonly fanart: boolean | null;
  /** What settles it: `GET /api/entries/{id}`. */
  readonly entryId: string | null;
}

/** The page of one item: the work as TMDB knows it, and the file as `ffprobe` read it. */
export interface ItemDetail extends LibraryItem {
  readonly overview: string | null;
  readonly runtime: number | null;
  readonly genres: readonly string[];
  readonly posterPath: string | null;
  readonly backdropPath: string | null;
  readonly file: {
    readonly video: string | null;
    readonly audio: string | null;
    readonly size: number;
  } | null;
}

export interface ScanProgress {
  readonly phase: 'discover' | 'identify' | 'plan';
  readonly found: number;
  readonly done: number;
  readonly total: number;
  readonly current: string | null;
  readonly idleSeconds: number;
}

export interface ItemsPage {
  readonly library: {
    readonly id: string;
    readonly name: string;
    readonly type: 'movie' | 'series';
    readonly path: string;
    readonly profile: string;
    readonly writes: { readonly nfo: boolean; readonly artwork: boolean };
  };
  /** `null` until a scan of the source has ended. */
  readonly scannedAt: string | null;
  readonly scan: {
    readonly jobId: string;
    readonly status: 'queued' | 'running';
    readonly progress: ScanProgress | null;
  } | null;
  readonly counts: Counts;
  readonly total: number;
  readonly items: readonly LibraryItem[];
}

export const PAGE_SIZE = 50;

export interface ItemsQuery {
  readonly state?: ItemFilter | undefined;
  readonly q?: string | undefined;
  readonly limit: number;
}

export function itemsUrl(libraryId: string, { state, q, limit }: ItemsQuery): string {
  const parameters = [
    ...(state ? [`state=${state}`] : []),
    ...(q?.trim() ? [`q=${encodeURIComponent(q.trim())}`] : []),
    `limit=${limit}`,
  ];
  return `/api/libraries/${libraryId}/items?${parameters.join('&')}`;
}

/** A show of a series library: `missing` is `null` until it was counted. */
export interface Show {
  readonly tmdbId: number;
  readonly title: string | null;
  readonly year: number | null;
  readonly seasons: number;
  readonly episodes: number;
  readonly missing: number | null;
}

export type EpisodeState = 'present' | 'missing' | 'unaired' | 'extra';

export interface ShowEpisode {
  readonly season: number;
  readonly episode: number;
  readonly title: string | null;
  readonly airDate: string | null;
  readonly state: EpisodeState;
  readonly item: LibraryItem | null;
}

export interface ShowSeason {
  readonly season: number;
  readonly name: string | null;
  readonly posterPath: string | null;
  readonly missing: number;
  readonly episodes: readonly ShowEpisode[];
}

/** The page of a show, season by season, as `GET /api/libraries/{id}/shows/{tmdbId}` gives it. */
export interface ShowDetail {
  readonly tmdbId: number;
  readonly title: string | null;
  readonly year: number | null;
  readonly overview: string | null;
  readonly genres: readonly string[];
  readonly posterPath: string | null;
  readonly backdropPath: string | null;
  readonly status: string | null;
  /** `false` when TMDB could not be asked: only the files are listed, nothing is missing. */
  readonly determined: boolean;
  readonly missing: number | null;
  readonly seasons: readonly ShowSeason[];
}

export interface ShowsQuery {
  readonly q?: string | undefined;
  readonly missing?: boolean | undefined;
  readonly limit: number;
}

export function showsUrl(libraryId: string, { q, missing, limit }: ShowsQuery): string {
  const parameters = [
    ...(q?.trim() ? [`q=${encodeURIComponent(q.trim())}`] : []),
    ...(missing ? ['missing=true'] : []),
    `limit=${limit}`,
  ];
  return `/api/libraries/${libraryId}/shows?${parameters.join('&')}`;
}

/** `S01E02`, or `S01E02-E03` for a file holding several episodes. */
export function episodeLabel(
  season: number | null,
  episode: number | null,
  episodeEnd: number | null = null,
): string {
  if (season === null || episode === null) {
    return '';
  }
  const two = (n: number): string => String(n).padStart(2, '0');
  return `S${two(season)}E${two(episode)}${episodeEnd === null ? '' : `-E${two(episodeEnd)}`}`;
}

/** Files that wait for a person: they have no show to sit under. */
export const isSettling = (item: Pick<LibraryItem, 'state'>): boolean =>
  item.state === 'review' || item.state === 'unrecognized';

export const libraryItems = {
  page: (libraryId: string, query: ItemsQuery) => api.get<ItemsPage>(itemsUrl(libraryId, query)),
  shows: (libraryId: string, query: ShowsQuery) =>
    api.get<{ total: number; items: readonly Show[] }>(showsUrl(libraryId, query)),
  show: (libraryId: string, tmdbId: number) =>
    api.get<ShowDetail>(`/api/libraries/${libraryId}/shows/${tmdbId}`),
  detail: (libraryId: string, itemId: string) =>
    api.get<ItemDetail>(`/api/libraries/${libraryId}/items/${itemId}`),
};

/** Whole percent of the identification, once the walk of the folder has told how many files. */
export function scanPercent(progress: ScanProgress | null): number | undefined {
  return progress && progress.phase !== 'discover' && progress.total > 0
    ? Math.min(100, Math.floor((progress.done / progress.total) * 100))
    : undefined;
}

/** Past this, the page says the scan is still running rather than leave a bar that does not move. */
export const STALLED_SECONDS = 60;
export const isStalled = (progress: ScanProgress | null): boolean =>
  (progress?.idleSeconds ?? 0) >= STALLED_SECONDS;

/** A file size for a person: `1.4 GB`. */
export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** A library with a typed snapshot (an arrival folder has none). */
export const isTyped = (library: Pick<Library, 'type'>): boolean => library.type != null;

/** A scan that failed and that nothing newer has replaced. */
export const lastScanFailed = (library: Pick<Library, 'lastScan' | 'scanning'>): boolean =>
  !library.scanning && library.lastScan?.status === 'failed';
