import type { MessageKey } from '@kinoshelf/i18n';
import { baseName } from './paths.js';

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
  readonly state: 'ready' | 'review' | 'unrecognized';
  readonly kind: 'movie' | 'series' | null;
  readonly resolution: string | null;
  /** What the parser read of the name: where a manual search starts. */
  readonly title: string | null;
  readonly year: number | null;
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
  /** The series' folder when other episodes of the release go along: the file alone would stand for them. */
  readonly folder: string | null;
  readonly conflicts: readonly ConflictBody[];
}

export type QueueStatus = 'ready' | 'to-validate' | 'nothing-found' | 'conflict' | 'failed';

/** What a file is waiting for. A failed transfer says so first: it needs a look, not a choice. */
export function statusOf(arrival: Pick<Arrival, 'state' | 'error' | 'conflicts'>): QueueStatus {
  if (arrival.error) {
    return 'failed';
  }
  return arrival.state === 'unrecognized'
    ? 'nothing-found'
    : arrival.state === 'ready'
      ? 'ready'
      : arrival.conflicts.length > 0
        ? 'conflict'
        : 'to-validate';
}

export const STATUS_LABEL: Record<QueueStatus, MessageKey> = {
  ready: 'web.queue.status.ready',
  'to-validate': 'web.queue.status.to-validate',
  'nothing-found': 'web.queue.status.nothing-found',
  conflict: 'web.queue.status.conflict',
  failed: 'web.queue.status.failed',
};

export const QUEUE_CHIP: Record<QueueStatus, string> = {
  ready: 'chip-ok',
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
  // `total` counts files, `releases` and the offset count releases: compare each to its own unit.
  while (seen < releases && items.length < first.total) {
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
      const files = group.others.get(item.cluster) ?? [];
      files.push(item);
      group.others.set(item.cluster, files);
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
export const releaseName = baseName;

/** The folder the file is in, shown apart so the release name stays readable. */
export function folderOf(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

/**
 * A poster served by our own server, which fetches it from TMDB once: the browser never contacts
 * TMDB. The API gives TMDB's path as is, with its leading slash.
 */
export function imageUrl(
  size: 'w92' | 'w154' | 'w300' | 'w342' | 'w500' | 'w780',
  path: string | null | undefined,
): string | undefined {
  const file = path?.replace(/^\/+/, '');
  return file ? `/api/images/${size}/${file}` : undefined;
}

/** A work's three images, and an episode's own (`thumb`, one file per version). */
export type ImageKind = 'poster' | 'fanart' | 'logo' | 'thumb';

/**
 * The image a work has in its folder (`base` is the work's API path), for the page to show what a
 * player will read. `version` changes after a replacement: the file is served with `no-cache`, but
 * the browser keeps what it already drew for an address.
 */
export const workImageUrl = (base: string, type: ImageKind, version: number): string =>
  `${base}/images/${type}/file?v=${String(version)}`;

export const posterUrl = (posterPath: string | undefined): string | undefined =>
  imageUrl('w92', posterPath);

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
  /** The picture size of this file when its name says none; `undefined`: read it automatically. */
  readonly screenSize?: string | undefined;
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
    ...(choice.screenSize !== undefined && { screenSize: choice.screenSize }),
  });
  if (matched.classification !== 'to-rename') {
    return { status: 'conflict', conflicts: matched.conflicts };
  }
  const followers = matched.followers ?? [];
  await post(`/api/plans/${arrival.jobId}/execute`, { entries: [arrival.id, ...followers] });
  return { status: 'started', followed: followers.length };
}

/**
 * Starts the transfer of files matched with confidence as the analysis planned them, with no new
 * choice: one execution per job (a release is a job), each asked for its own files. Returns how
 * many files were queued.
 */
export async function startPlanned(
  files: readonly Pick<Arrival, 'id' | 'jobId'>[],
  post: Post,
): Promise<number> {
  const byJob = new Map<string, string[]>();
  for (const { id, jobId } of files) {
    byJob.set(jobId, [...(byJob.get(jobId) ?? []), id]);
  }
  for (const [jobId, entries] of byJob) {
    await post(`/api/plans/${jobId}/execute`, { entries });
  }
  return files.length;
}
