/** Wrong keys an address may try within the window before it is made to wait. */
export const MAX_FAILURES = 10;
export const WINDOW_MS = 10 * 60_000;
/** Addresses remembered at most: a flood of addresses forgets the oldest, never grows memory. */
const MAX_ADDRESSES = 10_000;

/**
 * Wrong API keys, counted per address: past `MAX_FAILURES` within `WINDOW_MS`, the address is
 * refused (429) until its window ends, a right key included, so guessing a key costs time. A
 * right key clears the count. Kept in memory: a restart forgets it, which costs an attacker a
 * restart per ten guesses.
 */
export class AttemptLimiter {
  private readonly failures = new Map<string, { count: number; since: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Seconds the address must still wait, or 0 when it may try. */
  waitFor(address: string): number {
    const entry = this.failures.get(address);
    if (!entry) {
      return 0;
    }
    const left = entry.since + WINDOW_MS - this.now();
    if (left <= 0) {
      this.failures.delete(address);
      return 0;
    }
    return entry.count >= MAX_FAILURES ? Math.ceil(left / 1000) : 0;
  }

  failed(address: string): void {
    const now = this.now();
    const entry = this.failures.get(address);
    if (entry && entry.since + WINDOW_MS > now) {
      entry.count += 1;
      return;
    }
    if (this.failures.size >= MAX_ADDRESSES) {
      const oldest = this.failures.keys().next();
      if (!oldest.done) {
        this.failures.delete(oldest.value);
      }
    }
    this.failures.set(address, { count: 1, since: now });
  }

  succeeded(address: string): void {
    this.failures.delete(address);
  }
}
