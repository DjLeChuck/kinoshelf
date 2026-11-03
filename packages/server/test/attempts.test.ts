import { afterEach, describe, expect, it } from 'vitest';
import { AttemptLimiter, MAX_FAILURES, WINDOW_MS } from '../src/attempts.js';
import { cleanup, harness } from './harness.js';

afterEach(cleanup);

const HOST = 'kinoshelf.local';

describe('AttemptLimiter', () => {
  it('makes an address wait once it failed too often, until its window ends', () => {
    let now = 1_000_000;
    const limiter = new AttemptLimiter(() => now);
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) {
      limiter.failed('10.0.0.1');
    }
    expect(limiter.waitFor('10.0.0.1')).toBe(0);
    limiter.failed('10.0.0.1');
    expect(limiter.waitFor('10.0.0.1')).toBe(WINDOW_MS / 1000);
    expect(limiter.waitFor('10.0.0.2')).toBe(0);

    now += WINDOW_MS - 1500;
    expect(limiter.waitFor('10.0.0.1')).toBe(2);
    now += 1500;
    expect(limiter.waitFor('10.0.0.1')).toBe(0);
  });

  it('starts a new window for a failure after the last one ended', () => {
    let now = 0;
    const limiter = new AttemptLimiter(() => now);
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) {
      limiter.failed('a');
    }
    now = WINDOW_MS;
    limiter.failed('a');
    expect(limiter.waitFor('a')).toBe(0);
  });

  it('forgets an address once it gives the right key', () => {
    const limiter = new AttemptLimiter();
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) {
      limiter.failed('a');
    }
    limiter.succeeded('a');
    limiter.failed('a');
    expect(limiter.waitFor('a')).toBe(0);
  });
});

describe('wrong keys over HTTP', () => {
  const signIn = (h: Awaited<ReturnType<typeof harness>>, apiKey: string, remoteAddress?: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { host: HOST },
      payload: { apiKey },
      ...(remoteAddress && { remoteAddress }),
    });

  it('refuses even the right key once an address guessed too often', async () => {
    const h = await harness();
    for (let i = 0; i < MAX_FAILURES; i += 1) {
      expect((await signIn(h, 'ks_wrong')).statusCode).toBe(401);
    }
    const blocked = await signIn(h, h.apiKey);
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.json()).toMatchObject({ error: { code: 'auth.too-many-attempts' } });
    expect(blocked.headers['set-cookie']).toBeUndefined();

    // Another address is not held back by this one's guesses.
    expect((await signIn(h, h.apiKey, '10.0.0.9')).statusCode).toBe(200);
  });

  it('counts Bearer keys and sign-ins together', async () => {
    const h = await harness();
    for (let i = 0; i < MAX_FAILURES; i += 1) {
      const response = await h.app.inject({
        url: '/api/history',
        headers: { authorization: 'Bearer ks_wrong' },
      });
      expect(response.statusCode).toBe(401);
    }
    const bearer = await h.request('GET', '/api/history');
    expect(bearer.statusCode).toBe(429);
    expect(bearer.json()).toMatchObject({ error: { code: 'auth.too-many-attempts' } });
    expect((await signIn(h, h.apiKey)).statusCode).toBe(429);
  });

  it('does not let an untrusted X-Forwarded-For pick the address counted', async () => {
    const h = await harness();
    for (let i = 0; i < MAX_FAILURES; i += 1) {
      await h.app.inject({
        method: 'POST',
        url: '/api/session',
        headers: { host: HOST, 'x-forwarded-for': `10.1.0.${String(i)}` },
        payload: { apiKey: 'ks_wrong' },
      });
    }
    expect((await signIn(h, h.apiKey)).statusCode).toBe(429);
  });
});
