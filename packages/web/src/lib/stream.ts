/** What the stream needs of an `EventSource`, so a test can stand in for it. */
export interface Source {
  readonly readyState: number;
  addEventListener(type: string, listener: () => void): void;
  close(): void;
}

/** `EventSource.CLOSED`, which a test environment without `EventSource` lacks. */
export const CLOSED = 2;

/** How long to wait before asking again after the stream closed for good. */
export const RETRY_MS = 5000;

export interface StreamDeps {
  readonly open: () => Source;
  /** Asks the server whether the session still holds; throws when the server cannot answer. */
  readonly check: () => Promise<void>;
  /** Read after `check`: false sends the user to the sign-in page, which ends the stream. */
  readonly signedIn: () => boolean;
  readonly topics: readonly string[];
  readonly fire: (topic: string) => void;
  readonly setTimeout?: (run: () => void, ms: number) => unknown;
  readonly clearTimeout?: (timer: unknown) => void;
}

/**
 * One event stream, kept open while wanted. The browser retries a dropped connection by itself,
 * but gives up for good on an answer that is not a stream (a 401 once the session expired, a 502
 * from a proxy while the server restarts): the stream is then `CLOSED` and nothing would refresh
 * again. So a closed stream asks whether the session holds, and opens again if it does; a server
 * that cannot answer is asked again later.
 */
export class Stream {
  private source: Source | undefined;
  private wanted = false;
  /** Bumped by `disconnect`: a check that was under way when it came must not open again. */
  private generation = 0;
  private timer: unknown;

  constructor(private readonly deps: StreamDeps) {}

  connect(): void {
    this.wanted = true;
    if (!this.source && this.timer === undefined) {
      this.open();
    }
  }

  disconnect(): void {
    this.wanted = false;
    this.generation += 1;
    this.source?.close();
    this.source = undefined;
    if (this.timer !== undefined) {
      (this.deps.clearTimeout ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>);
      this.timer = undefined;
    }
  }

  private open(): void {
    const source = this.deps.open();
    this.source = source;
    for (const topic of this.deps.topics) {
      source.addEventListener(topic, () => {
        this.deps.fire(topic);
      });
    }
    source.addEventListener('error', () => {
      if (source === this.source && source.readyState === CLOSED) {
        source.close();
        this.source = undefined;
        this.later();
      }
    });
  }

  private later(): void {
    this.timer = (this.deps.setTimeout ?? setTimeout)(() => {
      this.timer = undefined;
      void this.recover();
    }, RETRY_MS);
  }

  private async recover(): Promise<void> {
    if (!this.wanted) {
      return;
    }
    const generation = this.generation;
    try {
      await this.deps.check();
    } catch {
      this.later();
      return;
    }
    if (generation === this.generation && this.deps.signedIn() && !this.source) {
      this.open();
    }
  }
}
