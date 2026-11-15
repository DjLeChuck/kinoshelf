import type { MatchFailure } from './matches.js';

/**
 * What the activity panel shows of a background task. `code` and `params` are translated by the
 * web (`web.activity.task.<code>`): the server never sends text.
 */
export interface ActivityTask {
  /** Stable for the life of the task, prefixed by its kind (`scan:<job>`, `undo:<batch>`). */
  readonly id: string;
  readonly kind: string;
  readonly code: string;
  readonly params: Readonly<Record<string, string | number>>;
  readonly status: 'running' | 'done' | 'failed';
  /** `null` when the task cannot tell how far it has got: the bar is then indeterminate. */
  readonly done: number | null;
  readonly total: number | null;
  readonly current: string | null;
  /** Where the task is followed in the web, a path with its query. */
  readonly href: string | null;
  readonly error: MatchFailure | null;
}

export interface ActivitySource {
  /** The tasks this source holds: those running, and any it keeps after they end. */
  list(): ActivityTask[];
  /**
   * A task seen running that the source no longer lists (it forgets as soon as it ends): what it
   * came to, or `undefined` to drop it silently.
   */
  ended?(task: ActivityTask): ActivityTask | undefined;
}

/** A finished task stays this long in the panel; a failed one lasts until the owner has had time to read it. */
export const DONE_KEPT_MS = 15_000;
export const FAILED_KEPT_MS = 10 * 60_000;

interface Ended {
  readonly task: ActivityTask;
  readonly at: number;
}

/**
 * What the server is doing in the background, in one list: scans, transfers, undos, tidy-ups…
 * It owns no state of its own worth keeping. The sources are the modules that already hold each
 * task in memory, so nothing is stored twice. It remembers which tasks it saw running, so that
 * one that ends is reported once (done for a few seconds, failed for longer) instead of
 * vanishing, and so that a task a source keeps for its own page (the last undo of a batch) is not
 * offered again long after it ended.
 */
export class Activity {
  private readonly live = new Map<string, { task: ActivityTask; source: ActivitySource }>();
  private readonly finished = new Map<string, Ended>();

  constructor(
    private readonly sources: readonly ActivitySource[],
    private readonly now: () => number = Date.now,
  ) {}

  /** The tasks to show: running ones first, then those that just ended. */
  list(): ActivityTask[] {
    const at = this.now();
    const seen = new Set<string>();
    for (const source of this.sources) {
      for (const task of source.list()) {
        seen.add(task.id);
        if (task.status === 'running') {
          this.live.set(task.id, { task, source });
          this.finished.delete(task.id);
        } else if (this.live.has(task.id)) {
          this.live.delete(task.id);
          this.finished.set(task.id, { task, at });
        }
      }
    }
    for (const [id, { task, source }] of [...this.live]) {
      if (!seen.has(id)) {
        this.live.delete(id);
        const result = source.ended?.(task);
        if (result && result.status !== 'running') {
          this.finished.set(id, { task: result, at });
        }
      }
    }
    for (const [id, { task, at: endedAt }] of [...this.finished]) {
      if (at - endedAt > (task.status === 'failed' ? FAILED_KEPT_MS : DONE_KEPT_MS)) {
        this.finished.delete(id);
      }
    }
    return [
      ...[...this.live.values()].map(({ task }) => task),
      ...[...this.finished.values()].map(({ task }) => task),
    ];
  }
}
