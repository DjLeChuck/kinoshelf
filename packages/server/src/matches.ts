import { KinoshelfError } from '@kinoshelf/core';
import { ApiError } from './api-error.js';

/** What a client reads of a failed match: the same `{ code, params }` an error response carries. */
export interface MatchFailure {
  readonly code: string;
  readonly params?: Readonly<Record<string, string | number>>;
}

export type MatchState =
  | {
      readonly status: 'running';
      /** Files whose metadata is loaded, out of the files the choice covers. */
      readonly done: number;
      readonly total: number;
      readonly current: string | null;
    }
  | {
      readonly status: 'done';
      /** Ids of the other episodes of the release that followed the choice. */
      readonly followers: readonly string[];
    }
  | { readonly status: 'failed'; readonly error: MatchFailure };

/** How many finished matches are remembered: a client reads one right after it ends. */
const KEPT = 200;

export const failureOf = (error: unknown): MatchFailure => {
  if (error instanceof ApiError) {
    return { code: error.code, ...(error.params && { params: error.params }) };
  }
  if (error instanceof KinoshelfError) {
    return error.info;
  }
  return { code: 'internal.unexpected' };
};

/**
 * The validations in flight and what the last one of each file said, in the memory of the server:
 * a match is a few seconds of work for a release, and nothing needs it after a restart (the file
 * is simply still waiting, as it was). One match at a time per release: two at once would plan
 * the same episodes twice and the last write would win.
 */
export class MatchTracker {
  private readonly states = new Map<string, MatchState>();
  private readonly locks = new Map<string, string>();

  constructor(
    /** Tells the clients something moved (the `progress` topic) or ended (`arrivals`). */
    private readonly changed: (ended: boolean) => void,
  ) {}

  /**
   * Starts a match of `entryId`, whose release is `lock` (the entry itself for a movie). Throws
   * 409 when that release is already being matched.
   */
  begin(entryId: string, lock: string, total: number): void {
    if (this.locks.has(lock)) {
      throw new ApiError(409, 'queue.match-in-progress');
    }
    this.locks.set(lock, entryId);
    this.states.set(entryId, { status: 'running', done: 0, total, current: null });
    this.changed(false);
  }

  progress(entryId: string, done: number, current: string): void {
    const state = this.states.get(entryId);
    if (state?.status === 'running') {
      this.states.set(entryId, { ...state, done, current });
      this.changed(false);
    }
  }

  finish(entryId: string, lock: string, followers: readonly string[]): void {
    this.end(entryId, lock, { status: 'done', followers });
  }

  fail(entryId: string, lock: string, error: unknown): void {
    this.end(entryId, lock, { status: 'failed', error: failureOf(error) });
  }

  get(entryId: string): MatchState | undefined {
    return this.states.get(entryId);
  }

  /** Whether a match of this release is in flight. */
  locked(lock: string): boolean {
    return this.locks.has(lock);
  }

  private end(entryId: string, lock: string, state: MatchState): void {
    this.locks.delete(lock);
    this.states.delete(entryId);
    this.states.set(entryId, state);
    // The oldest finished results go first (a Map iterates in insertion order).
    for (const [id, kept] of this.states) {
      if (this.states.size <= KEPT) {
        break;
      }
      if (kept.status !== 'running') {
        this.states.delete(id);
      }
    }
    this.changed(true);
  }
}
