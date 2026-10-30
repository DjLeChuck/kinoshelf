import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { generateApiKey, setApiKey } from '../src/auth.js';
import { migrated } from '../src/database.js';
import { createSession, endSession, isValidSession, readCookie } from '../src/sessions.js';
import { cleanup, harness } from './harness.js';

afterEach(cleanup);

const HOST = 'kinoshelf.local';

async function signIn(
  h: Awaited<ReturnType<typeof harness>>,
  headers: Record<string, string> = {},
): Promise<{ cookie: string; setCookie: string }> {
  const response = await h.app.inject({
    method: 'POST',
    url: '/api/session',
    headers: { host: HOST, ...headers },
    payload: { apiKey: h.apiKey },
  });
  expect(response.statusCode).toBe(200);
  const setCookie = String(response.headers['set-cookie']);
  return { cookie: setCookie.split(';')[0] ?? '', setCookie };
}

describe('session store', () => {
  it('keeps only a hash, expires, and ends on request', () => {
    const database = migrated(new Database(':memory:'));
    const now = new Date('2026-10-28T10:00:00Z');
    const token = createSession(database, now);
    expect(JSON.stringify(database.prepare('SELECT * FROM sessions').all())).not.toContain(token);
    expect(isValidSession(database, token, now)).toBe(true);
    expect(isValidSession(database, 'other', now)).toBe(false);
    expect(isValidSession(database, token, new Date('2026-11-04T10:00:01Z'))).toBe(false);

    endSession(database, token);
    expect(isValidSession(database, token, now)).toBe(false);
  });

  it('sweeps expired sessions when a new one opens', () => {
    const database = migrated(new Database(':memory:'));
    createSession(database, new Date('2026-01-01T00:00:00Z'));
    createSession(database, new Date('2026-10-28T00:00:00Z'));
    expect(database.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 });
  });

  it('is replaced when the API key changes', () => {
    const database = migrated(new Database(':memory:'));
    setApiKey(database, generateApiKey());
    const token = createSession(database);
    setApiKey(database, generateApiKey());
    expect(isValidSession(database, token)).toBe(false);
  });

  it('reads one cookie among several', () => {
    expect(readCookie('a=1; kinoshelf_session=abc=; b=2', 'kinoshelf_session')).toBe('abc=');
    expect(readCookie(undefined, 'a')).toBeUndefined();
  });
});

describe('POST /api/session', () => {
  it('trades the API key for an HttpOnly, SameSite=Strict cookie', async () => {
    const h = await harness();
    const { setCookie } = await signIn(h);
    expect(setCookie).toMatch(/^kinoshelf_session=[\w-]{40,}/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toContain('Secure');
    expect(setCookie).not.toContain(h.apiKey);
  });

  it('refuses a wrong key without setting a cookie', async () => {
    const { app } = await harness();
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { apiKey: 'ks_wrong' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.json()).toEqual({ error: { code: 'auth.unauthorized' } });
  });

  it('refuses a sign-in coming from another origin', async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { host: HOST, origin: 'https://evil.example' },
      payload: { apiKey: h.apiKey },
    });
    expect(response.statusCode).toBe(401);
  });

  it('answers 503 while no key exists', async () => {
    const { app, database } = await harness();
    database.prepare('DELETE FROM api_keys').run();
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { apiKey: 'ks_whatever' },
    });
    expect(response.statusCode).toBe(503);
  });
});

describe('a session cookie on /api routes', () => {
  it('opens the API without the key', async () => {
    const h = await harness();
    const { cookie } = await signIn(h);
    const response = await h.app.inject({ url: '/api/jobs', headers: { cookie } });
    expect(response.statusCode).toBe(200);
  });

  it('is not enough with a forged value', async () => {
    const { app } = await harness();
    const response = await app.inject({
      url: '/api/jobs',
      headers: { cookie: 'kinoshelf_session=forged' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('accepts a write from the UI origin and refuses one from another', async () => {
    const h = await harness();
    const { cookie } = await signIn(h);
    const post = (origin?: string) =>
      h.app.inject({
        method: 'POST',
        url: '/api/notifications/test',
        headers: { host: HOST, cookie, ...(origin && { origin }) },
      });
    expect((await post(`http://${HOST}`)).statusCode).toBe(200);
    expect((await post()).statusCode).toBe(200);
    expect((await post('https://evil.example')).statusCode).toBe(401);
  });

  it('stops working after sign-out, and sign-out clears the cookie', async () => {
    const h = await harness();
    const { cookie } = await signIn(h);
    const out = await h.app.inject({
      method: 'DELETE',
      url: '/api/session',
      headers: { host: HOST, cookie },
    });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
    expect((await h.app.inject({ url: '/api/jobs', headers: { cookie } })).statusCode).toBe(401);
  });

  it('stops working when the API key is replaced', async () => {
    const h = await harness();
    const { cookie } = await signIn(h);
    setApiKey(h.database, generateApiKey());
    expect((await h.app.inject({ url: '/api/jobs', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('GET /api/session', () => {
  it('reports whether the browser is signed in, without needing to be', async () => {
    const h = await harness();
    const anonymous = await h.app.inject({ url: '/api/session' });
    expect(anonymous.json()).toEqual({ authenticated: false, setup: false });

    const { cookie } = await signIn(h);
    const signed = await h.app.inject({ url: '/api/session', headers: { cookie } });
    expect(signed.json()).toEqual({ authenticated: true, setup: false });
  });
});

describe('first-launch API key', () => {
  it('says a key is missing, creates one once and opens no session', async () => {
    const h = await harness();
    h.database.prepare('DELETE FROM api_keys').run();
    const state = (await h.app.inject('/api/session')).json<{ setup: boolean }>();
    expect(state.setup).toBe(true);

    const created = await h.app.inject({ method: 'POST', url: '/api/setup/api-key' });
    expect(created.statusCode).toBe(200);
    expect(created.headers['set-cookie']).toBeUndefined();
    const { apiKey } = created.json<{ apiKey: string }>();
    const withKey = await h.app.inject({
      method: 'GET',
      url: '/api/jobs',
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(withKey.statusCode).toBe(200);

    const again = await h.app.inject({ method: 'POST', url: '/api/setup/api-key' });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: { code: 'setup.already-done' } });
    expect((await h.app.inject('/api/session')).json<{ setup: boolean }>().setup).toBe(false);
  });

  it('refuses to replace a key that exists', async () => {
    const h = await harness();
    const response = await h.app.inject({ method: 'POST', url: '/api/setup/api-key' });
    expect(response.statusCode).toBe(409);
  });

  it('refuses a request coming from another origin', async () => {
    const h = await harness();
    h.database.prepare('DELETE FROM api_keys').run();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/setup/api-key',
      headers: { host: HOST, origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(401);
  });
});
