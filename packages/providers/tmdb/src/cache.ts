/** A stored HTTP response. `status` is kept so a 404 can be cached as well as a 200. */
export interface CacheEntry {
  readonly status: number;
  readonly body: string;
}

/** Cache of TMDB responses (rate limits, large scans). Synchronous: SQLite is. */
export interface HttpCache {
  get(key: string, now: number): CacheEntry | undefined;
  set(key: string, entry: CacheEntry, expiresAt: number): void;
}

/** Process-lifetime cache, for tests and one-off runs. */
export class MemoryCache implements HttpCache {
  private readonly entries = new Map<string, { entry: CacheEntry; expiresAt: number }>();

  get(key: string, now: number): CacheEntry | undefined {
    const stored = this.entries.get(key);
    return stored && stored.expiresAt > now ? stored.entry : undefined;
  }

  set(key: string, entry: CacheEntry, expiresAt: number): void {
    this.entries.set(key, { entry, expiresAt });
  }
}
