import { afterEach, describe, expect, it } from 'vitest';
import { trustProxyOf } from '../src/app.js';
import { cleanup, harness } from './harness.js';

afterEach(cleanup);

describe('KINOSHELF_TRUST_PROXY', () => {
  it('reads unset and false as nobody, true as anyone, the rest as a list', () => {
    expect(trustProxyOf(undefined)).toBe(false);
    expect(trustProxyOf(' ')).toBe(false);
    expect(trustProxyOf('false')).toBe(false);
    expect(trustProxyOf('true')).toBe(true);
    expect(trustProxyOf('127.0.0.1, 10.0.0.0/8')).toBe('127.0.0.1, 10.0.0.0/8');
  });

  const behindProxy = (h: Awaited<ReturnType<typeof harness>>, origin: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/session',
      headers: {
        host: '127.0.0.1:8484',
        origin,
        'x-forwarded-host': 'media.example.org',
        'x-forwarded-proto': 'https',
      },
      payload: { apiKey: h.apiKey },
    });

  it('takes the host and scheme from a trusted proxy', async () => {
    const h = await harness({ env: { KINOSHELF_TRUST_PROXY: '127.0.0.1' } });
    const response = await behindProxy(h, 'https://media.example.org');
    expect(response.statusCode).toBe(200);
    expect(String(response.headers['set-cookie'])).toContain('Secure');
  });

  it('ignores the forwarded headers when no proxy is trusted', async () => {
    const h = await harness();
    expect((await behindProxy(h, 'https://media.example.org')).statusCode).toBe(401);
    const direct = await behindProxy(h, 'http://127.0.0.1:8484');
    expect(direct.statusCode).toBe(200);
    expect(String(direct.headers['set-cookie'])).not.toContain('Secure');
  });

  it('ignores them from an address that is not the trusted proxy', async () => {
    const h = await harness({ env: { KINOSHELF_TRUST_PROXY: '10.0.0.1' } });
    expect((await behindProxy(h, 'https://media.example.org')).statusCode).toBe(401);
  });

  it('checks the forwarded host name before creating the first key', async () => {
    const h = await harness({ env: { KINOSHELF_TRUST_PROXY: '127.0.0.1' } });
    h.database.prepare('DELETE FROM api_keys').run();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/setup/api-key',
      headers: { host: '127.0.0.1:8484', 'x-forwarded-host': 'evil.example' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: { code: 'setup.host-not-allowed', params: { host: 'evil.example' } },
    });
  });
});
