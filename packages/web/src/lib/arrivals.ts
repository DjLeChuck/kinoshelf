import type { MessageKey } from '@kinoshelf/i18n';

/** What a candidate looks like, in an arrival and in `GET /api/search`. */
export interface Candidate {
  readonly kind: 'movie' | 'series';
  readonly id: { readonly provider: 'tmdb'; readonly id: number };
  readonly title: string;
  readonly originalTitle: string;
  readonly year?: number;
  readonly posterPath?: string;
  /** 0 to 100; only the candidates of the analysis have one, a manual search has none. */
  readonly score?: number;
}

export interface ErrorBody {
  readonly code: string;
  readonly params?: Record<string, string | number>;
}

export interface ConflictBody {
  readonly reason: string;
  readonly path: string;
  readonly detail: ErrorBody | null;
}

/** A file that waits for a human: `GET /api/arrivals`, and `GET /api/entries/{id}` for any other. */
export interface Arrival {
  readonly id: string;
  readonly jobId: string;
  readonly path: string;
  /** The file's name. */
  readonly file: string;
  /** The folder (or file) it came in: files sharing it are validated together. */
  readonly release: string | null;
  /** Which series of the folder: 0 is the main one, 1 and up the others set apart from it. */
  readonly cluster: number;
  /** Another series than the main one of its folder (`cluster` above 0). */
  readonly detached: boolean;
  readonly state: 'review' | 'unrecognized';
  readonly kind: 'movie' | 'series' | null;
  readonly resolution: string | null;
  /** The arrival folder it came from; `null` for a path sent by hand or a file of a library. */
  readonly sourceId: string | null;
  readonly destination: { readonly libraryId: string | null };
  /** The libraries it could go to: its kind's, or all of them when the kind is unknown. */
  readonly destinationOptions: readonly { readonly id: string; readonly name: string }[];
  readonly reason: string | null;
  readonly candidates: readonly Candidate[];
  readonly conflicts: readonly ConflictBody[];
  readonly error: ErrorBody | null;
}

export interface ArrivalPage {
  readonly total: number;
  readonly sources: readonly {
    readonly id: string;
    readonly name: string;
    readonly path: string;
  }[];
  readonly items: readonly Arrival[];
}

export interface Preview {
  readonly destination: string | null;
  readonly conflicts: readonly ConflictBody[];
}

export type QueueStatus = 'to-validate' | 'nothing-found' | 'conflict' | 'failed';

/** What a file is waiting for. A failed transfer says so first: it needs a look, not a choice. */
export function statusOf(arrival: Pick<Arrival, 'state' | 'error' | 'conflicts'>): QueueStatus {
  if (arrival.error) {
    return 'failed';
  }
  return arrival.state === 'unrecognized'
    ? 'nothing-found'
    : arrival.conflicts.length > 0
      ? 'conflict'
      : 'to-validate';
}

export const STATUS_LABEL: Record<QueueStatus, MessageKey> = {
  'to-validate': 'web.queue.status.to-validate',
  'nothing-found': 'web.queue.status.nothing-found',
  conflict: 'web.queue.status.conflict',
  failed: 'web.queue.status.failed',
};

export const STATUS_CHIP: Record<QueueStatus, string> = {
  'to-validate': 'chip-warn',
  'nothing-found': 'chip-neutral',
  conflict: 'chip-danger',
  failed: 'chip-danger',
};

/** A release as the list shows it: its files, and the episodes set aside from it. */
export interface ReleaseGroup {
  readonly key: string;
  /** Name of the folder (the file's own name for a loose file). */
  readonly name: string;
  /** Files validated together; the first one stands for the group. */
  readonly files: readonly Arrival[];
  /** Other series found in the same folder, one group each: listed under the release, linked to it. */
  readonly others: readonly { readonly cluster: number; readonly files: readonly Arrival[] }[];
}

/** A release as the server pages them: a folder (or a loose file) within one job. */
export const releaseKey = (arrival: Pick<Arrival, 'jobId' | 'release' | 'path'>): string =>
  `${arrival.jobId}|${arrival.release ?? arrival.path}`;

/** The most releases one request may ask for (the API refuses more). */
const MAX_RELEASES = 200;

/**
 * Reads the first `releases` releases of the arrivals, `MAX_RELEASES` at a time. The API pages by
 * release, never cutting one between two pages, so the offset counts releases, not files.
 */
export async function readArrivals(
  releases: number,
  read: (limit: number, offset: number) => Promise<ArrivalPage>,
): Promise<ArrivalPage> {
  const count = (items: readonly Arrival[]): number => new Set(items.map(releaseKey)).size;
  const first = await read(Math.min(releases, MAX_RELEASES), 0);
  const items = [...first.items];
  let seen = count(first.items);
  while (seen < releases && seen < first.total) {
    const next = await read(Math.min(releases - seen, MAX_RELEASES), seen);
    if (next.items.length === 0) {
      break;
    }
    items.push(...next.items);
    seen += count(next.items);
  }
  return { ...first, items };
}

/**
 * Groups what the arrivals list returns by release, keeping the order of first appearance. A
 * release is a folder within one job, as the server pages them: the same folder sent twice is two
 * jobs, validated apart.
 */
export function groupReleases(items: readonly Arrival[]): ReleaseGroup[] {
  const groups = new Map<
    string,
    { folder: string; files: Arrival[]; others: Map<number, Arrival[]> }
  >();
  for (const item of items) {
    const folder = item.release ?? item.path;
    const key = releaseKey(item);
    const group = groups.get(key) ?? { folder, files: [], others: new Map<number, Arrival[]>() };
    if (item.cluster === 0) {
      group.files.push(item);
    } else {
      group.others.set(item.cluster, [...(group.others.get(item.cluster) ?? []), item]);
    }
    groups.set(key, group);
  }
  return [...groups].map(([key, { folder, files, others }]) => ({
    key,
    name: releaseName(folder),
    files,
    others: [...others]
      .sort(([a], [b]) => a - b)
      .map(([cluster, clusterFiles]) => ({ cluster, files: clusterFiles })),
  }));
}

/** The file name, which is what a release is called; the API gives the whole path. */
export function releaseName(path: string): string {
  const name = path.split('/').filter(Boolean).pop();
  return name ?? path;
}

/** The folder the file is in, shown apart so the release name stays readable. */
export function folderOf(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

/**
 * A poster served by our own server, which fetches it from TMDB once: the browser never contacts
 * TMDB. `posterPath` comes with its leading slash.
 */
export function posterUrl(posterPath: string | undefined): string | undefined {
  const file = posterPath?.replace(/^\/+/, '');
  return file ? `/api/images/w92/${file}` : undefined;
}

/** A search result is posted back as is, without the score only the analysis had. */
export function toMatchBody(candidate: Candidate): Omit<Candidate, 'score'> {
  return Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== 'score')) as Omit<
    Candidate,
    'score'
  >;
}

export const sameCandidate = (a: Candidate, b: Candidate): boolean =>
  a.kind === b.kind && a.id.id === b.id.id;

type Post = <T>(url: string, body?: unknown) => Promise<T>;

export interface Choice {
  readonly candidate: Candidate;
  /** Send the file to this library rather than the default one, for this file only. */
  readonly libraryId?: string | undefined;
}

export type ValidateOutcome =
  /** Matched, and the transfer is queued. `followed`: other files of the release that went along. */
  | { readonly status: 'started'; readonly followed: number }
  /** The plan refused the choice (target taken, name not buildable): the file stays to be settled. */
  | { readonly status: 'conflict'; readonly conflicts: readonly ConflictBody[] };

/**
 * The two steps of "Validate": match the file with the chosen candidate, then queue the transfer
 * of that file alone. The server queues it behind any transfer of the same job, so a matched file
 * is never left without one.
 */
export async function validate(
  arrival: Pick<Arrival, 'id' | 'jobId'>,
  choice: Choice,
  post: Post,
): Promise<ValidateOutcome> {
  const matched = await post<{
    classification: string;
    conflicts: readonly ConflictBody[];
    followers?: readonly string[];
  }>(`/api/entries/${arrival.id}/match`, {
    ...toMatchBody(choice.candidate),
    ...(choice.libraryId !== undefined && { libraryId: choice.libraryId }),
  });
  if (matched.classification !== 'to-rename') {
    return { status: 'conflict', conflicts: matched.conflicts };
  }
  const followers = matched.followers ?? [];
  await post(`/api/plans/${arrival.jobId}/execute`, { entries: [arrival.id, ...followers] });
  return { status: 'started', followed: followers.length };
}

/**
 * A title and a year read from a release name, to start a manual search from: the dots and
 * underscores become spaces, and what follows the year (or the picture size) is the release's.
 */
export function titleGuess(release: string): { title: string; year?: string } {
  const bare = release.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]+/g, ' ');
  // The last year wins: `Blade Runner 2049 2017` is a title that holds a year.
  const years = [...bare.matchAll(/\b(?:19|20)\d{2}\b/g)];
  const year = years.at(-1);
  const stops = [
    year?.index,
    bare.search(/\b(?:2160|1080|720|480)p\b/i),
    bare.search(/\bS\d{1,2}E\d{1,3}\b/i),
  ].filter((at): at is number => at !== undefined && at > 0);
  const cut = Math.min(...stops, bare.length);
  const title = bare.slice(0, cut).trim();
  return year?.index !== undefined && year.index === cut ? { title, year: year[0] } : { title };
}
