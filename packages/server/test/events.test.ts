import type { ReadableStreamDefaultReader } from 'node:stream/web';
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../src/events.js';
import { cleanup, harness, makeDir, put } from './harness.js';

afterEach(cleanup);

/** Reads an event stream until `done` says enough, then cancels it. */
async function collect(response: Response, done: (text: string) => boolean): Promise<string> {
  const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
  if (!reader) {
    throw new Error('no body');
  }
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + 5000;
  while (!done(text) && Date.now() < deadline) {
    const { value, done: ended } = await reader.read();
    if (ended) {
      break;
    }
    text += decoder.decode(value);
  }
  await reader.cancel();
  return text;
}

async function listening(overrides: Parameters<typeof harness>[0] = {}) {
  const h = await harness(overrides);
  const base = await h.app.listen({ host: '127.0.0.1', port: 0 });
  return { ...h, base, auth: { authorization: `Bearer ${h.apiKey}` } };
}

describe('EventBus', () => {
  it('fans out to subscribers until they unsubscribe', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const stop = bus.subscribe((topic) => seen.push(topic));
    bus.emit('jobs', 'arrivals');
    stop();
    bus.emit('history');
    expect(seen).toEqual(['jobs', 'arrivals']);
  });
});

describe('GET /api/events', () => {
  it('requires authentication', async () => {
    const { app } = await harness();
    expect((await app.inject('/api/events')).statusCode).toBe(401);
  });

  it('opens a text/event-stream with a ready event', async () => {
    const { base, auth } = await listening();
    const response = await fetch(`${base}/api/events`, { headers: auth });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-cache');
    expect(await collect(response, (t) => t.includes('event: ready'))).toContain('event: ready');
  });

  it('tells a client when a job is queued, then analyzed', async () => {
    const { base, auth } = await listening();
    const directory = await makeDir();
    await put(`${directory}/Dune.2021.mkv`);
    const response = await fetch(`${base}/api/events`, { headers: auth });
    const reading = collect(response, (t) => t.includes('event: arrivals'));
    await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ path: directory }),
    });
    const text = await reading;
    expect(text).toContain('event: jobs');
    expect(text).toContain('event: arrivals');
  });

  it('tells where an analysis is on a topic of its own, so lists do not reload with it', async () => {
    const { base, auth } = await listening();
    const directory = await makeDir();
    for (let n = 1; n <= 5; n++) {
      await put(`${directory}/Show.S01E0${String(n)}.mkv`);
    }
    const response = await fetch(`${base}/api/events`, { headers: auth });
    const reading = collect(response, (t) => t.includes('event: arrivals'));
    await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ path: directory }),
    });
    const text = await reading;
    expect(text).toContain('event: progress');
    // Queued, started, ended: never once per file.
    expect(text.match(/event: jobs\n/g)?.length).toBeLessThanOrEqual(3);
  });

  it('refuses a stream past 64 open ones, and takes one again once one closes', async () => {
    const { base, auth } = await listening();
    const open = await Promise.all(
      Array.from({ length: 64 }, () => fetch(`${base}/api/events`, { headers: auth })),
    );
    expect(open.every((response) => response.status === 200)).toBe(true);
    const refused = await fetch(`${base}/api/events`, { headers: auth });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: { code: 'events.too-many' } });

    await open[0]?.body?.cancel();
    await expect
      .poll(async () => {
        const again = await fetch(`${base}/api/events`, { headers: auth });
        await again.body?.cancel();
        return again.status;
      })
      .toBe(200);
    await Promise.all(
      open.slice(1).map((response) => response.body?.cancel() ?? Promise.resolve()),
    );
  });

  it('asks proxies not to buffer the stream', async () => {
    const { base, auth } = await listening();
    const response = await fetch(`${base}/api/events`, { headers: auth });
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    await response.body?.cancel();
  });

  it('does not keep the server from closing', async () => {
    const { app, base, auth } = await listening();
    const response = await fetch(`${base}/api/events`, { headers: auth });
    const reader = response.body?.getReader() as
      ReadableStreamDefaultReader<Uint8Array> | undefined;
    await reader?.read();
    await expect(app.close()).resolves.toBeUndefined();
    expect((await reader?.read())?.done).toBe(true);
  });
});
