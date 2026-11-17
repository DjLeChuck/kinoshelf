import { afterEach, describe, expect, it } from 'vitest';
import {
  Activity,
  DONE_KEPT_MS,
  FAILED_KEPT_MS,
  type ActivitySource,
  type ActivityTask,
} from '../src/activity.js';
import { join } from 'node:path';
import type { Config } from '@kinoshelf/core';
import { scanSource } from '../src/activity-sources.js';
import type { JobStore } from '../src/jobs.js';
import type { ProgressTracker } from '../src/progress.js';
import { cleanup, harness, makeDir, put } from './harness.js';

afterEach(cleanup);

const make = (id: string, status: ActivityTask['status'] = 'running'): ActivityTask => ({
  id,
  kind: 'test',
  code: 'test',
  params: {},
  status,
  done: null,
  total: null,
  current: null,
  href: null,
  error: null,
});

function setup() {
  let tasks: ActivityTask[] = [];
  let at = 0;
  const source: ActivitySource = {
    list: () => tasks,
    ended: (task) => (task.id === 'gone' ? make('gone', 'done') : undefined),
  };
  const activity = new Activity([source], () => at);
  return {
    activity,
    set: (next: ActivityTask[]) => {
      tasks = next;
    },
    wait: (ms: number) => {
      at += ms;
    },
  };
}

describe('Activity', () => {
  it('lists what runs', () => {
    const { activity, set } = setup();
    set([make('a')]);
    expect(activity.list().map(({ id }) => id)).toEqual(['a']);
  });

  it('never offers a task it did not see run (a result a source keeps for its page)', () => {
    const { activity, set } = setup();
    set([make('old', 'done'), make('older', 'failed')]);
    expect(activity.list()).toEqual([]);
  });

  it('keeps a task that ends as done, a few seconds', () => {
    const { activity, set, wait } = setup();
    set([make('a')]);
    activity.list();
    set([make('a', 'done')]);
    expect(activity.list().map(({ status }) => status)).toEqual(['done']);
    wait(DONE_KEPT_MS + 1);
    expect(activity.list()).toEqual([]);
  });

  it('keeps a failure for longer', () => {
    const { activity, set, wait } = setup();
    set([make('a')]);
    activity.list();
    set([make('a', 'failed')]);
    wait(DONE_KEPT_MS + 1);
    expect(activity.list().map(({ status }) => status)).toEqual(['failed']);
    wait(FAILED_KEPT_MS + 1);
    expect(activity.list()).toEqual([]);
  });

  it('asks the source what became of a task it forgot', () => {
    const { activity, set } = setup();
    set([make('gone'), make('silent')]);
    activity.list();
    set([]);
    expect(activity.list().map(({ id, status }) => [id, status])).toEqual([['gone', 'done']]);
  });

  it('shows a task again when it runs again', () => {
    const { activity, set } = setup();
    set([make('a')]);
    activity.list();
    set([make('a', 'done')]);
    activity.list();
    set([make('a')]);
    expect(activity.list().map(({ status }) => status)).toEqual(['running']);
  });
});

describe('GET /api/activity', () => {
  it('needs the key and lists nothing while the server is idle', async () => {
    const h = await harness();
    expect((await h.app.inject({ method: 'GET', url: '/api/activity' })).statusCode).toBe(401);
    const answer = await h.request('GET', '/api/activity');
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toEqual({ tasks: [] });
  });
});

describe('a task shorter than the time the web takes to ask', () => {
  it('is still reported, as done, when nobody read the list while it ran', async () => {
    const root = await makeDir();
    await put(join(root, 'Dune.2021.mkv'));
    const h = await harness();
    await h.request('POST', '/api/libraries', { name: 'Films', source: root, type: 'movie' });
    const scan = await h.request('POST', '/api/libraries/films/scan');
    const jobId = scan.json<{ id: string }>().id;
    await h.app.jobs.idle();

    const { tasks } = (await h.request('GET', '/api/activity')).json<{
      tasks: { id: string; status: string }[];
    }>();
    expect(tasks.map(({ id, status }) => [id, status])).toContainEqual([`scan:${jobId}`, 'done']);
  });
});

describe('where a scan is followed', () => {
  const config: Config = {
    libraries: [
      { id: 'films', name: 'Films', source: '/films', type: 'movie' },
      {
        id: 'arrivals',
        name: 'Arrivals',
        source: '/in',
        into: { movie: 'films', series: 'films' },
      },
    ],
  };

  const hrefOf = (libraryId: string | null): string | null => {
    const source = scanSource({
      progress: {
        scans: () => [['job-1', { phase: 'read', found: 1, done: 0, total: 1, current: null }]],
      } as unknown as ProgressTracker,
      jobs: { get: () => ({ id: 'job-1', libraryId, path: '/x' }) } as unknown as JobStore,
      config: () => config,
    });
    return source.list()[0]?.href ?? null;
  };

  it('is the library page for a typed library', () => {
    expect(hrefOf('films')).toBe('/libraries/films');
  });

  it('is the Arrivals tab for an arrival folder, which has no page of its own', () => {
    expect(hrefOf('arrivals')).toBe('/arrivals');
  });

  it('is the History for a job of no library, or of one deleted since', () => {
    expect(hrefOf(null)).toBe('/history/job-1');
    expect(hrefOf('gone')).toBe('/history/job-1');
  });
});
