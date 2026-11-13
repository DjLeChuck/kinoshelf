/** Where an analysis is: looking for videos, reading their names, matching them, or building the plan. */
export type ScanPhase = 'discover' | 'read' | 'identify' | 'plan';

/** What a client shows of a running analysis. */
export interface ScanProgress {
  readonly phase: ScanPhase;
  /** Videos found so far (the total while `identify` and `plan`). */
  readonly found: number;
  readonly done: number;
  readonly total: number;
  /** The last file matched, relative to the scanned folder when it can be. */
  readonly current: string | null;
  /** Seconds since anything moved: the client says "still running" past a minute. */
  readonly idleSeconds: number;
}

/** What a client shows of a running transfer: files settled out of the files it will go through. */
export interface TransferProgress {
  readonly done: number;
  readonly total: number;
  /** The last file settled (its source path). */
  readonly current: string | null;
}

/** What a client shows of an undo (or its check) while it runs: entries settled out of those to revert. */
export interface UndoProgress {
  readonly done: number;
  readonly total: number;
  /** The last file settled (where it was). */
  readonly current: string | null;
  /** A check reads the disk but changes nothing. */
  readonly dryRun: boolean;
}

interface State {
  phase: ScanPhase;
  found: number;
  done: number;
  total: number;
  current: string | null;
  movedAt: number;
}

/** At most this often a change is announced: a scan of thousands of files must not flood clients. */
export const NOTIFY_INTERVAL_MS = 500;

/**
 * The progress of the analyses, kept in the memory of the server and never in the database: it
 * only means something while the job runs, and a restart runs the job again from the start. The
 * idle time is computed here, so it does not depend on the clock of the browser.
 */
export class ProgressTracker {
  private readonly states = new Map<string, State>();
  private readonly transfers = new Map<string, TransferProgress>();
  private readonly undos = new Map<string, UndoProgress>();
  private lastNotified = 0;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    /** Tells the clients something moved (the `progress` topic, with no payload). */
    private readonly notify: () => void,
    private readonly now: () => number = Date.now,
  ) {}

  start(jobId: string): void {
    this.states.set(jobId, {
      phase: 'discover',
      found: 0,
      done: 0,
      total: 0,
      current: null,
      movedAt: this.now(),
    });
    this.changed();
  }

  found(jobId: string, found: number): void {
    this.update(jobId, { found, total: found });
  }

  /** The walk is over: every video is known, no name is read yet. */
  discovered(jobId: string, total: number): void {
    this.update(jobId, { phase: 'read', found: total, done: 0, total });
  }

  /** Names read so far: the parser is synchronous and slow enough on a big library to be seen. */
  parsed(jobId: string, done: number, total: number): void {
    this.update(jobId, { phase: 'read', found: total, done, total });
  }

  /** Every name is read: matching begins, none is matched yet. */
  identifying(jobId: string): void {
    this.update(jobId, { phase: 'identify', done: 0 });
  }

  identified(jobId: string, done: number, total: number, current: string): void {
    this.update(jobId, { phase: 'identify', found: total, done, total, current });
  }

  planning(jobId: string): void {
    this.update(jobId, { phase: 'plan' });
  }

  finish(jobId: string): void {
    this.states.delete(jobId);
  }

  /** A transfer begins: `total` files to settle, none yet. */
  startTransfer(executionId: string, total: number): void {
    this.transfers.set(executionId, { done: 0, total, current: null });
    this.changed();
  }

  transferred(executionId: string, done: number, current: string): void {
    const state = this.transfers.get(executionId);
    if (state) {
      this.transfers.set(executionId, { ...state, done, current });
      this.changed();
    }
  }

  finishTransfer(executionId: string): void {
    this.transfers.delete(executionId);
  }

  transferOf(executionId: string): TransferProgress | undefined {
    return this.transfers.get(executionId);
  }

  /** An undo (or its check) of a batch begins. */
  startUndo(batchId: string, total: number, dryRun: boolean): void {
    this.undos.set(batchId, { done: 0, total, current: null, dryRun });
    this.changed();
  }

  undoing(batchId: string, done: number, total: number, current: string): void {
    const state = this.undos.get(batchId);
    if (state) {
      this.undos.set(batchId, { ...state, done, total, current: current || null });
      this.changed();
    }
  }

  /** A check ending must not wipe the state of an undo that began meanwhile, nor the reverse. */
  finishUndo(batchId: string, dryRun: boolean): void {
    if (this.undos.get(batchId)?.dryRun === dryRun) {
      this.undos.delete(batchId);
    }
    this.changed();
  }

  undoOf(batchId: string): UndoProgress | undefined {
    return this.undos.get(batchId);
  }

  /** Whether a real undo of this batch is running: a second one would revert the same files twice. */
  isUndoing(batchId: string): boolean {
    return this.undos.get(batchId)?.dryRun === false;
  }

  /** The transfer going on, whichever job it belongs to: the queue runs one task at a time. */
  runningTransfer(): TransferProgress | undefined {
    return this.transfers.values().next().value;
  }

  of(jobId: string): ScanProgress | undefined {
    const state = this.states.get(jobId);
    return (
      state && {
        phase: state.phase,
        found: state.found,
        done: state.done,
        total: state.total,
        current: state.current,
        idleSeconds: Math.floor((this.now() - state.movedAt) / 1000),
      }
    );
  }

  /** Stops a pending announcement, for a clean shutdown. */
  close(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private update(jobId: string, change: Partial<State>): void {
    const state = this.states.get(jobId);
    if (!state) {
      return;
    }
    Object.assign(state, change, { movedAt: this.now() });
    this.changed();
  }

  /** Leading and trailing: the first change is told at once, the ones after it once per interval. */
  private changed(): void {
    const wait = this.lastNotified + NOTIFY_INTERVAL_MS - this.now();
    if (wait <= 0) {
      this.lastNotified = this.now();
      this.notify();
      return;
    }
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      this.lastNotified = this.now();
      this.notify();
    }, wait);
    this.timer.unref();
  }
}
