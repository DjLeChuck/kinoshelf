import { describe, expect, it } from 'vitest';
import { CLOSED, RETRY_MS, Stream, type Source, type StreamDeps } from '../src/lib/stream.js';

class FakeSource implements Source {
  readyState = 1;
  closed = false;
  private readonly listeners = new Map<string, (() => void)[]>();

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
    this.readyState = CLOSED;
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }

  /** The browser gave up: a 401 or a 502 instead of a stream. */
  fail(): void {
    this.readyState = CLOSED;
    this.emit('error');
  }
}

function setup(check: () => Promise<void> = () => Promise.resolve(), signedIn = true) {
  const sources: FakeSource[] = [];
  const fired: string[] = [];
  const timers: { run: () => void; ms: number }[] = [];
  const deps: StreamDeps = {
    open: () => {
      const source = new FakeSource();
      sources.push(source);
      return source;
    },
    check,
    signedIn: () => signedIn,
    topics: ['jobs', 'ready'],
    fire: (topic) => fired.push(topic),
    setTimeout: (run, ms) => timers.push({ run, ms }),
    clearTimeout: () => timers.splice(0),
  };
  const tick = async (): Promise<void> => {
    const due = timers.splice(0);
    for (const { run } of due) {
      run();
    }
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { stream: new Stream(deps), sources, fired, timers, tick };
}

describe('the event stream', () => {
  it('passes the server’s events on, and opens once however often it is asked', () => {
    const { stream, sources, fired } = setup();
    stream.connect();
    stream.connect();
    sources[0]?.emit('jobs');
    expect(sources).toHaveLength(1);
    expect(fired).toEqual(['jobs']);
  });

  it('leaves a dropped connection to the browser, which retries it by itself', () => {
    const { stream, sources, timers } = setup();
    stream.connect();
    sources[0]?.emit('error'); // still CONNECTING: the browser reconnects
    expect(timers).toEqual([]);
    expect(sources).toHaveLength(1);
  });

  it('opens again once the session is confirmed, after the browser gave up', async () => {
    let checks = 0;
    const { stream, sources, timers, tick } = setup(() => {
      checks += 1;
      return Promise.resolve();
    });
    stream.connect();
    sources[0]?.fail();
    expect(timers.map(({ ms }) => ms)).toEqual([RETRY_MS]);
    await tick();
    expect(checks).toBe(1);
    expect(sources).toHaveLength(2);
  });

  it('asks again later while the server cannot answer', async () => {
    let down = true;
    const { stream, sources, tick } = setup(() =>
      down ? Promise.reject(new Error('502')) : Promise.resolve(),
    );
    stream.connect();
    sources[0]?.fail();
    await tick();
    expect(sources).toHaveLength(1);
    down = false;
    await tick();
    expect(sources).toHaveLength(2);
  });

  it('stays closed when the session is gone: the sign-in page takes over', async () => {
    const { stream, sources, tick } = setup(() => Promise.resolve(), false);
    stream.connect();
    sources[0]?.fail();
    await tick();
    expect(sources).toHaveLength(1);
  });

  it('does not open again when disconnected while it was asking', async () => {
    let answer = (): void => undefined;
    const { stream, sources, tick } = setup(
      () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        }),
    );
    stream.connect();
    sources[0]?.fail();
    await tick();
    stream.disconnect();
    answer();
    await tick();
    expect(sources).toHaveLength(1);
  });

  it('stops trying once disconnected', async () => {
    const { stream, sources, timers, tick } = setup();
    stream.connect();
    sources[0]?.fail();
    stream.disconnect();
    expect(timers).toEqual([]);
    await tick();
    expect(sources).toHaveLength(1);
  });
});
