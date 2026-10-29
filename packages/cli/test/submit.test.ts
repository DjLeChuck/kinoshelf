import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, harness } from './helpers.js';

afterEach(cleanup);

const KEY = 'ks_0123456789abcdef0123456789abcdef';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A server that answers with `answer`, and remembers what it was asked. */
function server(answer: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = ((url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string),
    });
    return Promise.resolve(answer());
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

const queued = () => Response.json({ id: 'job-1', path: '/x', status: 'queued' }, { status: 202 });

describe('submit', () => {
  it('queues the path with the key from the environment', async () => {
    const s = server(queued);
    const h = await harness({ KINOSHELF_API_KEY: KEY }, { fetch: s.fetch });

    expect(await h.cli('submit', '/downloads/Dune.2021.mkv')).toBe(0);

    expect(s.calls).toEqual([
      {
        url: 'http://localhost:8484/api/jobs',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        body: { path: '/downloads/Dune.2021.mkv', apply: false },
      },
    ]);
    expect(h.out).toEqual([
      'Queued /downloads/Dune.2021.mkv on http://localhost:8484 (job job-1).',
    ]);
  });

  it('resolves a relative path, as a hook may run from anywhere', async () => {
    const s = server(queued);
    const h = await harness({ KINOSHELF_API_KEY: KEY }, { fetch: s.fetch });
    await h.cli('submit', 'Dune.mkv');
    expect(s.calls[0]?.body).toEqual({ path: resolve('Dune.mkv'), apply: false });
  });

  it('takes the address from the flag, then KINOSHELF_URL, then the port of the server', async () => {
    const s = server(queued);
    const env = {
      KINOSHELF_API_KEY: KEY,
      KINOSHELF_URL: 'http://nas:8484/',
      KINOSHELF_PORT: '9000',
    };
    await (
      await harness(env, { fetch: s.fetch })
    ).cli('submit', '/a.mkv', '--url', 'http://other/');
    await (await harness(env, { fetch: s.fetch })).cli('submit', '/a.mkv');
    await (
      await harness({ KINOSHELF_API_KEY: KEY, KINOSHELF_PORT: '9000' }, { fetch: s.fetch })
    ).cli('submit', '/a.mkv');
    expect(s.calls.map((call) => call.url)).toEqual([
      'http://other/api/jobs',
      'http://nas:8484/api/jobs',
      'http://localhost:9000/api/jobs',
    ]);
  });

  it('asks for the transfer with --apply', async () => {
    const s = server(queued);
    const h = await harness({ KINOSHELF_API_KEY: KEY }, { fetch: s.fetch });
    await h.cli('submit', '/a.mkv', '--apply');
    expect(s.calls[0]?.body).toEqual({ path: '/a.mkv', apply: true });
  });

  it('prints the job as JSON for a script', async () => {
    const h = await harness({ KINOSHELF_API_KEY: KEY }, { fetch: server(queued).fetch });
    await h.cli('submit', '/a.mkv', '--json');
    expect(JSON.parse(h.out.join('\n'))).toMatchObject({ id: 'job-1', status: 'queued' });
  });

  it('is a usage error without a key, and sends nothing', async () => {
    const s = server(queued);
    const h = await harness({}, { fetch: s.fetch });
    expect(await h.cli('submit', '/a.mkv')).toBe(2);
    expect(h.err.join('\n')).toContain('KINOSHELF_API_KEY');
    expect(s.calls).toEqual([]);
  });

  it('fails with a readable message when the server is down', async () => {
    const h = await harness(
      { KINOSHELF_API_KEY: KEY },
      { fetch: () => Promise.reject(new TypeError('fetch failed')) },
    );
    expect(await h.cli('submit', '/a.mkv')).toBe(1);
    expect(h.err.join('\n')).toBe(
      'Cannot reach the server at http://localhost:8484. Is it running?',
    );
  });

  it('translates what the server refuses with', async () => {
    const refuse = (status: number, error: object) => () => Response.json({ error }, { status });
    const wrongKey = await harness(
      { KINOSHELF_API_KEY: KEY },
      { fetch: server(refuse(401, { code: 'auth.unauthorized' })).fetch },
    );
    expect(await wrongKey.cli('submit', '/a.mkv')).toBe(1);
    expect(wrongKey.err.join('\n')).not.toContain('error.');
    expect(wrongKey.err.join('\n')).not.toBe('');

    const odd = await harness(
      { KINOSHELF_API_KEY: KEY },
      { fetch: server(() => new Response('<html>', { status: 502 })).fetch },
    );
    expect(await odd.cli('submit', '/a.mkv')).toBe(1);
    expect(odd.err.join('\n')).toBe('The server refused the request (HTTP 502).');
  });

  it('speaks French when asked to', async () => {
    const h = await harness({ KINOSHELF_API_KEY: KEY }, { fetch: server(queued).fetch });
    await h.cli('--lang', 'fr', 'submit', '/a.mkv');
    expect(h.out.join('\n')).toBe(
      '/a.mkv mis en file d’attente sur http://localhost:8484 (tâche job-1).',
    );
  });
});
