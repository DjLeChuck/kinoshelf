import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@kinoshelf/core';
import { NOTIFY_INTERVAL_MS, ProgressTracker } from '../src/progress.js';
import { cleanup, fakeProvider, harness, makeDir, put } from './harness.js';

afterEach(() => {
  vi.useRealTimers();
  return cleanup();
});

describe('ProgressTracker', () => {
  it('follows an analysis through its phases, then forgets it', () => {
    const tracker = new ProgressTracker(() => undefined);
    expect(tracker.of('j')).toBeUndefined();
    tracker.start('j');
    tracker.found('j', 12);
    expect(tracker.of('j')).toMatchObject({ phase: 'discover', found: 12, total: 12, done: 0 });
    tracker.discovered('j', 12);
    expect(tracker.of('j')).toMatchObject({ phase: 'identify', done: 0, total: 12 });
    tracker.identified('j', 5, 12, 'a/b.mkv');
    expect(tracker.of('j')).toMatchObject({
      phase: 'identify',
      done: 5,
      total: 12,
      current: 'a/b.mkv',
    });
    tracker.planning('j');
    expect(tracker.of('j')).toMatchObject({ phase: 'plan', done: 5 });
    tracker.finish('j');
    expect(tracker.of('j')).toBeUndefined();
    // A late report of a finished job is ignored, not resurrected.
    tracker.identified('j', 6, 12, 'c.mkv');
    expect(tracker.of('j')).toBeUndefined();
  });

  it('counts the seconds since anything moved, by its own clock', () => {
    let now = 1_000_000;
    const tracker = new ProgressTracker(
      () => undefined,
      () => now,
    );
    tracker.start('j');
    now += 4500;
    expect(tracker.of('j')?.idleSeconds).toBe(4);
    tracker.identified('j', 1, 2, 'x.mkv');
    expect(tracker.of('j')?.idleSeconds).toBe(0);
  });

  it('tells the clients at once, then at most twice a second', () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const tracker = new ProgressTracker(notify, () => Date.now());
    tracker.start('j');
    expect(notify).toHaveBeenCalledTimes(1);
    for (let done = 1; done <= 100; done++) {
      tracker.identified('j', done, 100, 'x.mkv');
    }
    // A burst is one announcement, sent when the interval is over: the last state is what counts.
    expect(notify).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(NOTIFY_INTERVAL_MS);
    expect(notify).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10 * NOTIFY_INTERVAL_MS);
    expect(notify).toHaveBeenCalledTimes(2);
  });
});

describe('the progress of a scan, over the API', () => {
  it('shows where a running analysis is, in the job and in the library, and nothing after', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const configDir = await makeDir();
    await put(join(configDir, 'config.yaml'), '');
    const h = await harness({
      configDir,
      config: await loadConfig(configDir),
      // Nothing is matched until the test says so.
      createProvider: () => ({
        ...fakeProvider,
        searchMovies: async (query) => {
          await gate;
          return fakeProvider.searchMovies(query);
        },
      }),
    });
    const root = await makeDir();
    await put(join(root, 'Dune.2021.mkv'));
    await put(join(root, 'Alien.1979.mkv'));
    await h.request('POST', '/api/libraries', { name: 'Films', source: root, type: 'movie' });
    const scan = await h.request('POST', '/api/libraries/films/scan');
    const jobId = scan.json<{ id: string }>().id;

    type Job = {
      status: string;
      progress: { phase: string; found: number; done: number; total: number } | null;
    };
    const read = async (): Promise<Job> =>
      (await h.request('GET', `/api/jobs/${jobId}`)).json<Job>();
    try {
      await vi.waitFor(async () => {
        expect((await read()).progress).toMatchObject({
          phase: 'identify',
          done: 0,
          total: 2,
          found: 2,
        });
      });
      const listed = (await h.request('GET', '/api/jobs')).json<Job[]>();
      expect(listed[0]?.progress).toMatchObject({ phase: 'identify', total: 2 });
      const library = (await h.request('GET', '/api/libraries/films/items')).json<{
        scan: { jobId: string; progress: { phase: string } | null } | null;
      }>();
      expect(library.scan).toMatchObject({ jobId, progress: { phase: 'identify' } });
    } finally {
      release();
    }
    await h.app.jobs.idle();
    expect(await read()).toMatchObject({ status: 'done', progress: null });
  });
});
