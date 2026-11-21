import type { MessageKey } from '@kinoshelf/i18n';
import { ApiError } from './api.js';
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
  /** The files of its group TMDB has no season and episode for (sorted by name). */
  /** What keeps its best candidate from a full score (`code` is a `ScoreLimit`). */
  readonly limits: readonly { readonly code: string; readonly value: string | null }[];
  readonly unknownEpisodes: readonly {
    readonly file: string;
    readonly season: number | null;
    /** `false`: TMDB has no such season at all, so there is no page to link to. */
    readonly seasonKnown: boolean;
  }[];
  /** The folder (or file) it came in: files sharing it are validated together. */
  readonly release: string | null;
  /** Which series of the folder: 0 is the main one, 1 and up the others set apart from it. */
  readonly cluster: number;
  /** Another series than the main one of its folder (`cluster` above 0). */
  readonly detached: boolean;
  readonly state: ArrivalState;
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
  /** What the destination library already holds of it; `null`: nothing. */
  readonly duplicate: Duplicate | null;
  /** Files of its release the library already holds: said when the release is only partly there. */
  readonly presentEpisodes: readonly { readonly file: string }[];
}

/** Where Arrivals lists a file: the four tabs. */
export type ArrivalState = 'ready' | 'review' | 'unrecognized' | 'present';

export interface Duplicate {
  /** A hardlink, a file of the same size, or the same work in a file of another size. */
  readonly kind: 'same-file' | 'same-size' | 'other-version';
  /** The library file it duplicates. */
  readonly path: string;
  readonly file: string;
  readonly libraryId: string;
  readonly libraryName: string;
  readonly resolution: string | null;
  /** The library file's id in its library's list, to open its page. */
  readonly itemId: string;
  readonly tmdbId: number | null;
  readonly title: string | null;
  readonly season: number | null;
  readonly episode: number | null;
  /** Bytes: the arrival's size, which `same-size` is about. */
  readonly size: number | null;
  /** `asked`: processed anyway, to validate. `confirmed`: validated, it goes out. */
  readonly forced: 'asked' | 'confirmed' | null;
}

/** Where the library page of a file the library holds is: a movie's list, a series on its episode. */
export function libraryLinkOf(duplicate: Duplicate, kind: 'movie' | 'series' | null): string {
  const base = `/libraries/${duplicate.libraryId}`;
  if (kind === 'series' && duplicate.tmdbId !== null) {
    const id = String(duplicate.tmdbId);
    const season = duplicate.season === null ? '' : `&seasons=${id}:${String(duplicate.season)}`;
    return `${base}?open=${id}${season}`;
  }
  const query = new URLSearchParams({ item: duplicate.itemId });
  if (duplicate.title !== null) {
    query.set('q', duplicate.title);
  }
  return `${base}?${query.toString()}`;
}

export interface ArrivalPage {
  readonly total: number;
  /** Files in each state, whatever the filter: the badges of the tabs. */
  readonly counts: Readonly<Record<ArrivalState, number>>;
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

export type QueueStatus =
  'ready' | 'to-validate' | 'nothing-found' | 'conflict' | 'failed' | 'present';

/** What a file is waiting for. A failed transfer says so first: it needs a look, not a choice. */
export function statusOf(arrival: Pick<Arrival, 'state' | 'error' | 'conflicts'>): QueueStatus {
  if (arrival.error) {
    return 'failed';
  }
  return arrival.state === 'unrecognized'
    ? 'nothing-found'
    : arrival.state === 'present'
      ? 'present'
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
  present: 'web.queue.status.present',
};

export const QUEUE_CHIP: Record<QueueStatus, string> = {
  ready: 'chip-ok',
  'to-validate': 'chip-warn',
  'nothing-found': 'chip-neutral',
  conflict: 'chip-danger',
  failed: 'chip-danger',
  present: 'chip-neutral',
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

/**
 * A name cut in the middle to fit a narrow row, keeping its start (the title) and its end (the
 * quality and the extension), which are what tells two files apart.
 */
export function truncateMiddle(text: string, max = 42): string {
  if (text.length <= max) {
    return text;
  }
  const keep = max - 1;
  const head = Math.ceil(keep * 0.6);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
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

/**
 * Whether "Transfer" (the plan as it is) applies rather than "Validate" (a new choice): the file
 * was matched with confidence and the candidate chosen is still the first. Compared by work, never
 * by object: the list is read again on each event, and the candidate held by the panel is then
 * another object for the same work.
 */
export const goesAsPlanned = (
  ready: boolean,
  selected: Candidate | undefined,
  first: Candidate | undefined,
): boolean =>
  ready && selected !== undefined && first !== undefined && sameCandidate(selected, first);

type Post = <T>(url: string, body?: unknown) => Promise<T>;

/**
 * The file a validation or an ignore was started on, read when the click happened: the panel may
 * show another row by the end, and the list may no longer hold this one.
 */
export interface Settled {
  readonly id: string;
  /** The group the lists settle it with (`settleKey`). */
  readonly key: string;
  /** Set aside, not sent to a transfer: the list must not say a transfer started. */
  readonly ignored: boolean;
}

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
  | { readonly status: 'conflict'; readonly conflicts: readonly ConflictBody[] }
  /** Matched, but the library holds the file already: nothing was queued, it waits in "Already in the library". */
  | { readonly status: 'present' };

/** What `GET /api/entries/{id}/match` says: where the validation is, or how it ended. */
interface MatchState {
  readonly status: 'running' | 'done' | 'failed';
  readonly done?: number;
  readonly total?: number;
  readonly followers?: readonly string[];
  readonly entry?: { readonly classification: string; readonly conflicts: readonly ConflictBody[] };
  /** Where Arrivals lists the file once matched. */
  readonly arrival?: ArrivalState;
  readonly error?: { readonly code?: string; readonly params?: Record<string, string | number> };
}

type Get = <T>(url: string) => Promise<T>;

/** How the client follows a validation: it reads its state each time the server says it moved. */
export interface Watch {
  readonly get: Get;
  /** Calls the listener whenever the server announces progress; returns how to stop listening. */
  readonly changes: (listener: () => void) => () => void;
  /** Called with the files whose metadata is loaded, out of those the choice covers. */
  readonly onprogress?: (done: number, total: number) => void;
}

/**
 * Reads the match until it is no longer running. The listener is set before the first read, and an
 * event that comes while a read is under way is remembered: none can slip between a read and the
 * wait for the next. A dropped stream announces itself again (`ready`) when it reconnects.
 */
async function untilEnded(id: string, watch: Watch): Promise<MatchState> {
  let wake: (() => void) | undefined;
  let moved = false;
  // A function, so the compiler does not take the flag for always false: the listener sets it.
  const hasMoved = (): boolean => moved;
  const stop = watch.changes(() => {
    moved = true;
    wake?.();
  });
  try {
    for (;;) {
      moved = false;
      const state = await watch.get<MatchState>(`/api/entries/${id}/match`);
      if (state.status !== 'running') {
        return state;
      }
      watch.onprogress?.(state.done ?? 0, state.total ?? 0);
      if (!hasMoved()) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = undefined;
      }
    }
  } finally {
    stop();
  }
}

/**
 * The two steps of "Validate": match the file with the chosen candidate, then queue the transfer
 * of that file alone. The server plans the release on its own and answers at once, so the match
 * is followed until it ends (a release takes as long as it is long, and the server says how far it is). The
 * server queues the transfer behind any other of the same job, so a matched file is never left
 * without one.
 */
export async function validate(
  arrival: Pick<Arrival, 'id' | 'jobId'>,
  choice: Choice,
  post: Post,
  watch: Watch,
): Promise<ValidateOutcome> {
  await post(`/api/entries/${arrival.id}/match`, {
    ...toMatchBody(choice.candidate),
    ...(choice.libraryId !== undefined && { libraryId: choice.libraryId }),
    ...(choice.screenSize !== undefined && { screenSize: choice.screenSize }),
  });
  const state = await untilEnded(arrival.id, watch);
  if (state.status === 'failed') {
    throw new ApiError(500, state.error?.code ?? 'internal.unexpected', state.error?.params);
  }
  if (state.arrival === 'present') {
    return { status: 'present' };
  }
  if (state.entry?.classification !== 'to-rename') {
    return { status: 'conflict', conflicts: state.entry?.conflicts ?? [] };
  }
  const followers = state.followers ?? [];
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
