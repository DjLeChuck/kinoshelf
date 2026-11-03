import { KinoshelfError } from '@kinoshelf/core';
import type { z } from 'zod';
import { MemoryCache, type HttpCache } from './cache.js';

export interface TmdbClientOptions {
  /** A v4 "API Read Access Token" (sent as a Bearer token) or a v3 API key (`api_key` query). */
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly cache?: HttpCache;
  /** Maximum simultaneous requests (ignored when a `pool` is given). */
  readonly concurrency?: number;
  /** Shared by the clients of one process: the limit and the requests in flight are its, not theirs. */
  readonly pool?: RequestPool;
  /** Retries after a 429, a 5xx or a network failure. */
  readonly maxRetries?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

export interface GetOptions {
  /** How long a successful (or 404) response stays cached. */
  readonly ttlMs: number;
  /** Return `null` on 404 instead of throwing. */
  readonly nullOn404?: boolean;
}

type Raw = { status: number; body: string };

/**
 * What the clients of one process share: the simultaneous-request limit (a provider per call
 * would otherwise each get its own) and the requests in flight, so two callers asking the same
 * thing at once make one request.
 */
export class RequestPool {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly inflight = new Map<string, Promise<Raw>>();

  constructor(private readonly concurrency = 8) {}

  /** Runs `task` once for a key while one is already running. */
  once(key: string, task: () => Promise<Raw>): Promise<Raw> {
    const running = this.inflight.get(key);
    if (running) {
      return running;
    }
    const started = task().finally(() => this.inflight.delete(key));
    this.inflight.set(key, started);
    return started;
  }

  async limited<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

const RETRY_BASE_MS = 500;
const MAX_RETRY_AFTER_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;

/** `Retry-After` is a number of seconds or an HTTP date; 0 when absent or unreadable. */
function retryAfterOf(header: string | null, now: number): number {
  if (header === null) {
    return 0;
  }
  const seconds = Number(header);
  if (header.trim() !== '' && Number.isFinite(seconds)) {
    return seconds * 1000;
  }
  const date = Date.parse(header);
  return Number.isNaN(date) ? 0 : Math.max(0, date - now);
}

// A v4 read access token is a JWT; v3 keys are 32 hex characters.
const isBearerToken = (apiKey: string): boolean => apiKey.startsWith('eyJ');

export class TmdbClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cache: HttpCache;
  private readonly pool: RequestPool;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(options: TmdbClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.themoviedb.org';
    this.fetchImpl = options.fetch ?? fetch;
    this.cache = options.cache ?? new MemoryCache();
    this.pool = options.pool ?? new RequestPool(options.concurrency);
    this.maxRetries = options.maxRetries ?? 3;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }

  async get<T>(
    path: string,
    params: Readonly<Record<string, string | number | undefined>>,
    schema: z.ZodType<T>,
    options: GetOptions,
  ): Promise<T | null> {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) {
      if (value !== undefined) {
        query.set(name, String(value));
      }
    }
    // The key never takes part in the cache key nor in error parameters.
    const cacheKey = `${path}?${query.toString()}`;

    const cached = this.cache.get(cacheKey, this.now());
    // The key is the cache's: the same path and query is the same request.
    const entry =
      cached ?? (await this.pool.once(cacheKey, () => this.fetchWithRetry(path, query)));

    if (entry.status === 404) {
      if (!cached) {
        this.cache.set(cacheKey, entry, this.now() + options.ttlMs);
      }
      if (options.nullOn404) {
        return null;
      }
      throw new KinoshelfError('tmdb.not-found', { path });
    }

    let json: unknown;
    try {
      json = JSON.parse(entry.body);
    } catch {
      throw new KinoshelfError('tmdb.invalid-response', { path });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new KinoshelfError('tmdb.invalid-response', { path });
    }
    // Kept only once it reads right: a captive portal's page or a cut body is not cached for days.
    if (!cached) {
      this.cache.set(cacheKey, entry, this.now() + options.ttlMs);
    }
    return parsed.data;
  }

  private async fetchWithRetry(
    path: string,
    query: URLSearchParams,
  ): Promise<{ status: number; body: string }> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const url = new URL(path, this.baseUrl);
    url.search = query.toString();
    if (isBearerToken(this.apiKey)) {
      headers.authorization = `Bearer ${this.apiKey}`;
    } else {
      url.searchParams.set('api_key', this.apiKey);
    }

    for (let attempt = 0; ; attempt += 1) {
      const last = attempt >= this.maxRetries;
      let response: Response | undefined;
      let body: string | undefined;
      try {
        response = await this.pool.limited(() =>
          this.fetchImpl(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
        );
        // A connection cut while the body arrives is a network failure like any other: retried.
        if (response.status === 200 || response.status === 404) {
          body = await response.text();
        }
      } catch {
        if (last) {
          throw new KinoshelfError('tmdb.network', { path });
        }
        await this.sleep(RETRY_BASE_MS * 2 ** attempt);
        continue;
      }

      const { status } = response;
      if (body !== undefined) {
        return { status, body };
      }
      // Not read, so not left open: an unconsumed body keeps its connection.
      void response.body?.cancel().catch(() => undefined);
      if (status === 401) {
        throw new KinoshelfError('tmdb.invalid-key');
      }
      if (status === 429 || status >= 500) {
        if (last) {
          throw new KinoshelfError(status === 429 ? 'tmdb.rate-limited' : 'tmdb.http-error', {
            path,
            status,
          });
        }
        const retryAfterMs = retryAfterOf(response.headers.get('retry-after'), this.now());
        const delay =
          status === 429 && retryAfterMs > 0
            ? Math.min(retryAfterMs, MAX_RETRY_AFTER_MS)
            : RETRY_BASE_MS * 2 ** attempt;
        await this.sleep(delay);
        continue;
      }
      throw new KinoshelfError('tmdb.http-error', { path, status });
    }
  }
}
