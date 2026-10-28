import { describe, expect, it, vi } from 'vitest';
import { ApiError, NETWORK_ERROR, request, setUnauthorizedHandler } from '../src/lib/api.js';

const json = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('request', () => {
  it('sends JSON with the session cookie, and parses the answer', async () => {
    const fetcher = vi.fn().mockResolvedValue(json(200, { ok: true }));
    const result = await request('POST', '/api/x', { a: 1 }, fetcher);
    expect(result).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith('/api/x', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{"a":1}',
    });
  });

  it('sends no body or content type on a GET', async () => {
    const fetcher = vi.fn().mockResolvedValue(json(200, []));
    await request('GET', '/api/x', undefined, fetcher);
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(init).not.toHaveProperty('body');
    expect(init.headers).toEqual({ accept: 'application/json' });
  });

  it('returns nothing for a 204', async () => {
    expect(
      await request('DELETE', '/api/session', undefined, () => Promise.resolve(json(204))),
    ).toBe(undefined);
  });

  it('turns an error answer into an ApiError with its code and parameters', async () => {
    const fetcher = () =>
      Promise.resolve(json(409, { error: { code: 'job.busy', params: { status: 'running' } } }));
    await expect(request('POST', '/api/x', undefined, fetcher)).rejects.toMatchObject({
      status: 409,
      code: 'job.busy',
      params: { status: 'running' },
    });
  });

  it('reports a server that does not answer as a network error', async () => {
    const fetcher = () => Promise.reject(new TypeError('Failed to fetch'));
    const failure = await request('GET', '/api/x', undefined, fetcher).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 0, code: NETWORK_ERROR });
  });

  it('does not take a page that is not JSON for an answer', async () => {
    const fetcher = () => Promise.resolve(new Response('<html>', { status: 502 }));
    await expect(request('GET', '/api/x', undefined, fetcher)).rejects.toMatchObject({
      status: 502,
      code: 'request.rejected',
    });
  });

  it('tells the app when the session is refused, except while signing in', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    const refused = () => Promise.resolve(json(401, { error: { code: 'auth.unauthorized' } }));

    await expect(request('GET', '/api/jobs', undefined, refused)).rejects.toMatchObject({
      code: 'auth.unauthorized',
    });
    expect(handler).toHaveBeenCalledTimes(1);

    await expect(request('POST', '/api/session', { apiKey: 'x' }, refused)).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
