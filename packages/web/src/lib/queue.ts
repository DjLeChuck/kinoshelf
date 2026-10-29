import type { MessageKey } from '@kinoshelf/i18n';

/** What `GET /api/queue` and `GET /api/search` return, as far as the screen reads it. */
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

export interface QueueEntry {
  readonly id: string;
  readonly jobId: string;
  readonly path: string;
  readonly classification: 'compliant' | 'to-rename' | 'conflict' | 'ambiguous' | 'unrecognized';
  readonly resolution: 'done' | 'failed' | 'ignored' | null;
  readonly parsed: {
    readonly kind: string;
    readonly title?: string;
    readonly year?: number;
    readonly season?: number;
    readonly episodes: readonly number[];
  };
  readonly reason: string | null;
  readonly candidates: readonly Candidate[];
  readonly destination: string | null;
  readonly conflicts: readonly ConflictBody[];
  readonly error: ErrorBody | null;
}

export interface Preview {
  readonly destination: string | null;
  readonly conflicts: readonly ConflictBody[];
}

export type QueueStatus = 'to-validate' | 'nothing-found' | 'conflict' | 'failed';

/** What a file is waiting for. A failed transfer says so first: it needs a look, not a choice. */
export function statusOf(entry: QueueEntry): QueueStatus {
  if (entry.resolution === 'failed') {
    return 'failed';
  }
  return entry.classification === 'unrecognized'
    ? 'nothing-found'
    : entry.classification === 'conflict'
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
export function posterUrl(
  posterPath: string | undefined,
  size: 'w92' | 'w154' = 'w92',
): string | undefined {
  const file = posterPath?.replace(/^\/+/, '');
  return file ? `/api/images/${size}/${file}` : undefined;
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

/** `S02E05`, `S02E05-E06`, `S02`: what the parser read of the numbering. */
export function episodeLabel(parsed: QueueEntry['parsed']): string | undefined {
  if (parsed.season === undefined) {
    return undefined;
  }
  const season = `S${String(parsed.season).padStart(2, '0')}`;
  const episodes = parsed.episodes.map((n) => `E${String(n).padStart(2, '0')}`);
  return episodes.length > 0 ? `${season}${episodes.join('-')}` : season;
}

/** The entry that should be open: the chosen one if it is still there, else the first. */
export function pickSelection(
  entries: readonly QueueEntry[],
  current: string | undefined,
): string | undefined {
  return entries.find((entry) => entry.id === current)?.id ?? entries[0]?.id;
}

type Post = <T>(url: string, body?: unknown) => Promise<T>;

export type ValidateOutcome =
  /** Matched, and the transfer is queued. */
  | { readonly status: 'started' }
  /** The plan refused the choice (target taken, name not buildable): the file stays in the queue. */
  | { readonly status: 'conflict'; readonly entry: QueueEntry };

/**
 * The two steps of "Validate": match the file with the chosen candidate (it leaves the queue),
 * then queue the transfer of that file alone. The server queues it behind any transfer of the same
 * job, so a matched file is never left without one.
 */
export async function validate(
  entry: QueueEntry,
  candidate: Candidate,
  post: Post,
): Promise<ValidateOutcome> {
  const matched = await post<QueueEntry>(`/api/queue/${entry.id}/match`, toMatchBody(candidate));
  if (matched.classification !== 'to-rename') {
    return { status: 'conflict', entry: matched };
  }
  await post(`/api/plans/${entry.jobId}/execute`, { entries: [entry.id] });
  return { status: 'started' };
}
