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
/** A series library also filters its shows. Its tabs count shows, except the files that wait for a person. */
export type ShowFilter = ItemFilter | 'missing-episodes' | 'missing-show-files';
export const SERIES_FILTERS: readonly ShowFilter[] = [
  ...ITEM_FILTERS,
  'missing-episodes',
  'missing-show-files',
];
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
  /** The folder it came in; files sharing it and `cluster` are validated together. `null`: not told. */
  readonly release: string | null;
  readonly cluster: number | null;
  /** How many files validating this one settles, the whole release even past the page read. */
  readonly releaseFiles: number | null;
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
  readonly phase: 'discover' | 'read' | 'identify' | 'plan';
  readonly found: number;
  readonly done: number;
  readonly total: number;
  readonly current: string | null;
  readonly idleSeconds: number;
}

/** Where a transfer is: files settled out of the files it goes through. */
export interface TransferProgress {
  readonly done: number;
  readonly total: number;
  readonly current: string | null;
}

export interface ItemsPage {
  readonly library: {
    readonly writes: { readonly nfo: boolean; readonly artwork: boolean };
  };
  /** `null` until a scan of the source has ended. */
  readonly scannedAt: string | null;
  readonly scan: {
    readonly jobId: string;
    readonly status: 'queued' | 'running';
    readonly progress: ScanProgress | null;
    /** The transfer this scan waits behind, if any. */
    readonly transfer: TransferProgress | null;
  } | null;
  /** The transfer going on, whichever batch it belongs to. */
  readonly transfer: TransferProgress | null;
  readonly counts: Counts;
  readonly total: number;
  /** `total` as a validation settles it: a release's episodes count once. */
  readonly groups: number;
  readonly items: readonly LibraryItem[];
}

export const PAGE_SIZE = 50;

export interface ItemsQuery {
  readonly state?: ItemFilter | undefined;
  readonly q?: string | undefined;
  readonly limit: number;
  readonly offset?: number;
}

export function itemsUrl(libraryId: string, { state, q, limit, offset }: ItemsQuery): string {
  const parameters = [
    ...(state ? [`state=${state}`] : []),
    ...(q?.trim() ? [`q=${encodeURIComponent(q.trim())}`] : []),
    `limit=${limit}`,
    ...(offset ? [`offset=${offset}`] : []),
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
  /** Episodes to rename, and to refresh (NFO or image missing): what the show's checkbox runs. */
  readonly rename: number;
  readonly refresh: number;
  /** The show's own files; `null`: the profile does not write it, or it was not looked at yet. */
  readonly nfo: boolean | null;
  readonly poster: boolean | null;
  readonly fanart: boolean | null;
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
  /** The season's poster file is on the disk; `null`: not written, or not looked at yet. */
  readonly poster: boolean | null;
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
  readonly incomplete?: boolean | undefined;
  /** Only the shows holding a file of this state (or lacking this kind of file). */
  readonly state?: ItemFilter | undefined;
  readonly limit: number;
  readonly offset?: number;
}

export function showsUrl(
  libraryId: string,
  { q, missing, incomplete, state, limit, offset }: ShowsQuery,
): string {
  const parameters = [
    ...(q?.trim() ? [`q=${encodeURIComponent(q.trim())}`] : []),
    ...(missing ? ['missing=true'] : []),
    ...(incomplete ? ['incomplete=true'] : []),
    ...(state ? [`state=${state}`] : []),
    `limit=${limit}`,
    ...(offset ? [`offset=${offset}`] : []),
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

/** Files validated together: one release's episodes of one series, or a file alone. */
export interface SettleGroup {
  readonly key: string;
  /** The folder's path, or the file's own when it stands alone. */
  readonly name: string;
  readonly items: readonly LibraryItem[];
  /** Files the validation settles: the server's count, since the list holds only its first page. */
  readonly files: number;
  /** Another series than the main one of its folder. */
  readonly detached: boolean;
}

/** Only episodes are validated as a release (the server leaves movies alone). */
export const settleKey = (item: LibraryItem): string =>
  item.release !== null && item.cluster !== null && item.kind === 'series'
    ? `${item.release}|${item.cluster}`
    : item.path;

/** Groups the files that wait for a person the way the server settles them, in order of appearance. */
export function groupSettling(items: readonly LibraryItem[]): SettleGroup[] {
  const groups = new Map<string, LibraryItem[]>();
  for (const item of items) {
    const key = settleKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups].map(([key, files]) => {
    const [first] = files;
    return {
      key,
      name:
        (first?.releaseFiles ?? files.length) > 1 && first?.release
          ? first.release
          : (first?.path ?? key),
      items: files,
      files: Math.max(files.length, first?.releaseFiles ?? 1),
      detached: (first?.cluster ?? 0) > 0,
    };
  });
}

/** What a dry run of a selection says of one file: each operation, checked and not run. */
export interface ReportOperation {
  readonly type: 'transfer' | 'write-file' | 'download';
  readonly role: string | null;
  readonly source: string | null;
  readonly destination: string;
  readonly status: 'done' | 'failed' | 'skipped';
  readonly error: {
    readonly code: string;
    readonly params?: Readonly<Record<string, string | number>>;
  } | null;
}

export interface RunReport {
  readonly batchId: string;
  readonly items: readonly {
    readonly entryId: string;
    readonly results: readonly ReportOperation[];
  }[];
  /** Items of the selection with nothing to do. */
  readonly skipped: readonly string[];
}

/** Only a video to rename or a file to complete has something to run. */
export const canRun = (item: Pick<LibraryItem, 'state'>): boolean =>
  item.state === 'rename' || item.state === 'incomplete';

/** The picture sizes offered when naming a version by hand, the highest first. */
export const PICTURE_SIZES = ['2160p', '1440p', '1080p', '720p', '576p', '480p'] as const;

/** Naming a version: the size to use (chosen by hand, or the one the name says). */
export interface VersionRequest {
  /** `undefined`: the server reads it from the file name, then from the file. */
  readonly screenSize?: string;
}

const versionBody = (version: VersionRequest | undefined) =>
  version === undefined
    ? {}
    : {
        version: true,
        ...(version.screenSize !== undefined && { screenSize: version.screenSize }),
      };

/** The size to start from for an item: the one its name says, when it is one that can be picked. */
export const sizeOfItem = (item: Pick<LibraryItem, 'resolution'>): string =>
  PICTURE_SIZES.find((size) => size === item.resolution) ?? '';

/**
 * A movie or an episode can be asked to name its version (`- 2160p`) whatever its state: the size
 * is the one its file name says, then the one read from the file, or one chosen by hand.
 */
export const canNameVersion = (item: Pick<LibraryItem, 'kind' | 'entryId' | 'state'>): boolean =>
  item.kind !== null &&
  item.entryId !== null &&
  item.state !== 'review' &&
  item.state !== 'unrecognized';

/** A selection split by what it asks: "Rename" takes the first, "Refresh" the second. */
export function partition(items: readonly Pick<LibraryItem, 'id' | 'state'>[]): {
  readonly rename: string[];
  readonly refresh: string[];
} {
  return {
    rename: items.filter(({ state }) => state === 'rename').map(({ id }) => id),
    refresh: items.filter(({ state }) => state === 'incomplete').map(({ id }) => id),
  };
}

/** What a report amounts to: the videos moved, the files written, and what would not be. */
export function tally(report: Pick<RunReport, 'items'>): {
  transfers: number;
  written: number;
  skipped: number;
  failed: number;
} {
  const results = report.items.flatMap(({ results: operations }) => operations);
  const count = (keep: (r: ReportOperation) => boolean): number => results.filter(keep).length;
  return {
    transfers: count(({ type, status }) => type === 'transfer' && status !== 'skipped'),
    written: count(({ type, status }) => type !== 'transfer' && status !== 'skipped'),
    skipped: count(({ status }) => status === 'skipped'),
    failed: count(({ status }) => status === 'failed'),
  };
}

/** The most a list request may ask for (the API refuses more). */
export const MAX_PAGE = 200;

/**
 * Reads the first `limit` lines of a list, `MAX_PAGE` at a time: "Show more" grows past what one
 * request may ask for. The first answer gives everything but the lines (counts, total…).
 */
export async function inChunks<
  T extends { readonly total: number; readonly items: readonly unknown[] },
>(limit: number, read: (limit: number, offset: number) => Promise<T>): Promise<T> {
  const first = await read(Math.min(limit, MAX_PAGE), 0);
  const items = [...first.items];
  while (items.length < limit && items.length < first.total) {
    const next = await read(Math.min(limit - items.length, MAX_PAGE), items.length);
    if (next.items.length === 0) {
      break;
    }
    items.push(...next.items);
  }
  return { ...first, items };
}

export const libraryItems = {
  preview: (libraryId: string, items: readonly string[], version?: VersionRequest) =>
    api.post<RunReport>(`/api/libraries/${libraryId}/execute`, {
      items,
      dryRun: true,
      ...versionBody(version),
    }),
  run: (libraryId: string, items: readonly string[], version?: VersionRequest) =>
    api.post<{ skipped: readonly string[] }>(`/api/libraries/${libraryId}/execute`, {
      items,
      ...versionBody(version),
    }),
  page: (libraryId: string, query: ItemsQuery) =>
    inChunks(query.limit, (limit, offset) =>
      api.get<ItemsPage>(itemsUrl(libraryId, { ...query, limit, offset })),
    ),
  shows: (libraryId: string, query: ShowsQuery) =>
    inChunks(query.limit, (limit, offset) =>
      api.get<{ total: number; items: readonly Show[] }>(
        showsUrl(libraryId, { ...query, limit, offset }),
      ),
    ),
  show: (libraryId: string, tmdbId: number) =>
    api.get<ShowDetail>(`/api/libraries/${libraryId}/shows/${tmdbId}`),
  detail: (libraryId: string, itemId: string) =>
    api.get<ItemDetail>(`/api/libraries/${libraryId}/items/${itemId}`),
  /** Where a scan is, without the counts and the page around it. */
  scan: (jobId: string) =>
    api.get<{
      readonly status: 'queued' | 'running' | 'done' | 'failed';
      readonly progress: ScanProgress | null;
      readonly transfer: TransferProgress | null;
    }>(`/api/jobs/${jobId}`),
};

/**
 * Whole percent of the reading of names or of the identification, once the walk of the folder has told how many files. The
 * planning that follows (details fetched for every work) has no count: the bar must not sit at 100%.
 */
export function scanPercent(progress: ScanProgress | null): number | undefined {
  return (progress?.phase === 'read' || progress?.phase === 'identify') && progress.total > 0
    ? Math.min(100, Math.floor((progress.done / progress.total) * 100))
    : undefined;
}

/** Past this, the page says the scan is still running rather than leave a bar that does not move. */
export const STALLED_SECONDS = 60;
export const isStalled = (progress: ScanProgress | null): boolean =>
  (progress?.idleSeconds ?? 0) >= STALLED_SECONDS;

/** A scan that failed and that nothing newer has replaced. */
export const lastScanFailed = (library: Pick<Library, 'lastScan' | 'scanning'>): boolean =>
  !library.scanning && library.lastScan?.status === 'failed';

/** A file's presence in a table cell: nothing when the profile writes no such file. */
export const presenceMark = (value: boolean | null): string =>
  value === null ? '' : value ? '✓' : '✗';
