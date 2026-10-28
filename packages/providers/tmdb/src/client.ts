import { KinoshelfError } from '@kinoshelf/core';
import type { z } from 'zod';
import { MemoryCache, type HttpCache } from './cache.js';

export interface TmdbClientOptions {
  /** A v4 "API Read Access Token" (sent as a Bearer token) or a v3 API key (`api_key` query). */
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly cache?: HttpCache;
  /** Maximum simultaneous requests. */
  readonly concurrency?: number;
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

const RETRY_BASE_MS = 500;
const MAX_RETRY_AFTER_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;

// A v4 read access token is a JWT; v3 keys are 32 hex characters.
const isBearerToken = (apiKey: string): boolean => apiKey.startsWith('eyJ');

export class TmdbClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cache: HttpCache;
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(options: TmdbClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.themoviedb.org';
    this.fetchImpl = options.fetch ?? fetch;
    this.cache = options.cache ?? new MemoryCache();
    this.concurrency = options.concurrency ?? 8;
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

    let entry = this.cache.get(cacheKey, this.now());
    if (!entry) {
      entry = await this.fetchWithRetry(path, query);
      if (entry.status === 200 || entry.status === 404) {
        this.cache.set(cacheKey, entry, this.now() + options.ttlMs);
      }
    }

    if (entry.status === 404) {
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
      try {
        response = await this.limited(() =>
          this.fetchImpl(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
        );
      } catch {
        if (last) {
          throw new KinoshelfError('tmdb.network', { path });
        }
        await this.sleep(RETRY_BASE_MS * 2 ** attempt);
        continue;
      }

      const { status } = response;
      if (status === 200 || status === 404) {
        return { status, body: await response.text() };
      }
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
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay =
          status === 429 && retryAfter > 0
            ? Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS)
            : RETRY_BASE_MS * 2 ** attempt;
        await this.sleep(delay);
        continue;
      }
      throw new KinoshelfError('tmdb.http-error', { path, status });
    }
  }

  private async limited<T>(task: () => Promise<T>): Promise<T> {
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
