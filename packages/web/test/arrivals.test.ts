import { describe, expect, it } from 'vitest';
import { en, fr } from '@kinoshelf/i18n';
import {
  STATUS_LABEL,
  folderOf,
  posterUrl,
  groupReleases,
  readArrivals,
  releaseName,
  sameCandidate,
  statusOf,
  toMatchBody,
  startPlanned,
  validate,
  type Arrival,
  type Candidate,
} from '../src/lib/arrivals.js';

const arrival = (over: Partial<Arrival> = {}): Arrival => ({
  id: 'e1',
  jobId: 'j1',
  path: '/downloads/Dune.2021.1080p/Dune.2021.1080p.mkv',
  file: 'Dune.2021.1080p.mkv',
  release: '/downloads/Dune.2021.1080p',
  cluster: 0,
  detached: false,
  state: 'review',
  kind: 'movie',
  resolution: '1080p',
  title: 'Dune',
  year: 2021,
  sourceId: 'dl',
  destination: { libraryId: 'films' },
  destinationOptions: [{ id: 'films', name: 'Films' }],
  reason: null,
  candidates: [],
  conflicts: [],
  error: null,
  ...over,
});

describe('statusOf', () => {
  const conflict = [{ reason: 'destination-exists', path: '/x', detail: null }];
  it.each([
    [{}, 'to-validate'],
    [{ state: 'unrecognized' }, 'nothing-found'],
    [{ state: 'ready' }, 'ready'],
    [{ conflicts: conflict }, 'conflict'],
    [{ error: { code: 'x' } }, 'failed'],
    // A transfer that failed after a conflict is first a failure.
    [{ conflicts: conflict, error: { code: 'x' } }, 'failed'],
  ] as const)('%j is %s', (over, expected) => {
    expect(statusOf(arrival(over as Partial<Arrival>))).toBe(expected);
  });

  it('has a label in both languages for each status', () => {
    for (const key of Object.values(STATUS_LABEL)) {
      expect(en[key]).toBeTruthy();
      expect(fr[key]).toBeTruthy();
    }
  });
});

describe('paths', () => {
  it('takes the release name and the folder from the path', () => {
    expect(releaseName('/a/b/Dune.mkv')).toBe('Dune.mkv');
    expect(folderOf('/a/b/Dune.mkv')).toBe('/a/b');
    expect(folderOf('/Dune.mkv')).toBe('/');
  });
});

describe('posterUrl', () => {
  it('goes through the server, whatever the slash of TMDB’s path', () => {
    expect(posterUrl('/abc.jpg')).toBe('/api/images/w92/abc.jpg');
    expect(posterUrl('abc.jpg')).toBe('/api/images/w92/abc.jpg');
  });

  it('is absent without a poster, and never points at TMDB', () => {
    expect(posterUrl(undefined)).toBeUndefined();
    expect(posterUrl('')).toBeUndefined();
    expect(posterUrl('/abc.jpg')).not.toContain('tmdb');
  });
});

const dune: Candidate = {
  kind: 'movie',
  id: { provider: 'tmdb', id: 438631 },
  title: 'Dune',
  originalTitle: 'Dune',
  year: 2021,
  score: 91,
};

describe('candidates', () => {
  it('drops the score from what is posted back', () => {
    expect(toMatchBody(dune)).not.toHaveProperty('score');
    expect(toMatchBody(dune)).toMatchObject({ title: 'Dune', year: 2021 });
  });

  it('tells two candidates apart by kind and id: a movie and a series may share an id', () => {
    expect(sameCandidate(dune, toMatchBody(dune))).toBe(true);
    expect(sameCandidate(dune, { ...dune, kind: 'series' })).toBe(false);
  });
});

describe('validate', () => {
  /**
   * `states` is what each read of the match says, in turn (the last one repeats). The server
   * announces a change after every read that found the match still running, as it would.
   */
  const recorder = (states: readonly object[], failure?: Error) => {
    const calls: { url: string; body: unknown }[] = [];
    const listeners = new Set<() => void>();
    let read = 0;
    const post = <T>(url: string, body?: unknown): Promise<T> => {
      calls.push({ url, body });
      return failure && url.includes('/execute')
        ? Promise.reject(failure)
        : Promise.resolve({} as T);
    };
    const get = <T>(url: string): Promise<T> => {
      calls.push({ url, body: undefined });
      const state = states[Math.min(read++, states.length - 1)] as { status: string };
      if (state.status === 'running') {
        setTimeout(() => {
          for (const listener of [...listeners]) {
            listener();
          }
        }, 0);
      }
      return Promise.resolve(state as T);
    };
    const progress: [number, number][] = [];
    return {
      calls,
      post,
      progress,
      listeners,
      watch: {
        get,
        changes: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        onprogress: (done: number, total: number) => progress.push([done, total]),
      },
    };
  };
  const done = (over: object = {}) => ({
    status: 'done',
    entry: { classification: 'to-rename', conflicts: [] },
    followers: [],
    ...over,
  });

  it('matches, waits for the plan, then queues the transfer of the file', async () => {
    const { calls, post, watch } = recorder([done()]);
    expect(await validate(arrival(), { candidate: dune }, post, watch)).toEqual({
      status: 'started',
      followed: 0,
    });
    expect(calls.map((c) => c.url)).toEqual([
      '/api/entries/e1/match',
      '/api/entries/e1/match',
      '/api/plans/j1/execute',
    ]);
    expect(calls[0]?.body).not.toHaveProperty('score');
    expect(calls[2]?.body).toEqual({ entries: ['e1'] });
  });

  it('reports how far the server is until it ends', async () => {
    const { post, watch, progress } = recorder([
      { status: 'running', done: 0, total: 3 },
      { status: 'running', done: 2, total: 3 },
      done(),
    ]);
    await validate(arrival(), { candidate: dune }, post, watch);
    expect(progress).toEqual([
      [0, 3],
      [2, 3],
    ]);
  });

  it('stops listening once the match ended, whatever the way it ended', async () => {
    const ok = recorder([{ status: 'running', done: 1, total: 2 }, done()]);
    await validate(arrival(), { candidate: dune }, ok.post, ok.watch);
    expect(ok.listeners.size).toBe(0);
    const failed = recorder([{ status: 'failed', error: { code: 'internal.unexpected' } }]);
    await expect(
      validate(arrival(), { candidate: dune }, failed.post, failed.watch),
    ).rejects.toBeDefined();
    expect(failed.listeners.size).toBe(0);
  });

  it('does not wait for an event that came while it was reading', async () => {
    const { post, watch, listeners } = recorder([{ status: 'running', done: 0, total: 2 }, done()]);
    // The announcement lands during the first read, before the wait begins.
    const get = watch.get;
    const racing = {
      ...watch,
      get: <T>(url: string): Promise<T> => {
        const answer = get<T>(url);
        for (const listener of [...listeners]) {
          listener();
        }
        return answer;
      },
    };
    await expect(validate(arrival(), { candidate: dune }, post, racing)).resolves.toMatchObject({
      status: 'started',
    });
  });

  it('does not transfer a file the plan put in conflict, and says why', async () => {
    const conflicts = [{ reason: 'destination-exists', path: '/x', detail: null }];
    const { calls, post, watch } = recorder([
      done({ entry: { classification: 'conflict', conflicts } }),
    ]);
    expect(await validate(arrival(), { candidate: dune }, post, watch)).toEqual({
      status: 'conflict',
      conflicts,
    });
    expect(calls.some((c) => c.url.includes('/execute'))).toBe(false);
  });

  it('transfers the rest of the release along, and says how many went', async () => {
    const { calls, post, watch } = recorder([done({ followers: ['e2', 'e3'] })]);
    expect(await validate(arrival(), { candidate: dune }, post, watch)).toEqual({
      status: 'started',
      followed: 2,
    });
    expect(calls.at(-1)?.body).toEqual({ entries: ['e1', 'e2', 'e3'] });
  });

  it('sends only the choices that differ from the defaults', async () => {
    const { calls, post, watch } = recorder([done()]);
    await validate(arrival(), { candidate: dune }, post, watch);
    await validate(arrival(), { candidate: dune, libraryId: 'uhd' }, post, watch);
    const bodies = calls
      .filter((c) => c.url.includes('/match') && c.body !== undefined)
      .map((c) => c.body);
    expect(bodies[0]).not.toHaveProperty('libraryId');
    expect(bodies[1]).toMatchObject({ libraryId: 'uhd' });
  });

  it('throws the cause of a validation that failed on the server', async () => {
    const { post, watch } = recorder([
      { status: 'failed', error: { code: 'internal.unexpected' } },
    ]);
    await expect(validate(arrival(), { candidate: dune }, post, watch)).rejects.toMatchObject({
      code: 'internal.unexpected',
    });
  });

  it('gives the error back when the transfer cannot be queued', async () => {
    const failure = new Error('down');
    const { post, watch } = recorder([done()], failure);
    await expect(validate(arrival(), { candidate: dune }, post, watch)).rejects.toBe(failure);
  });
});

describe('groupReleases', () => {
  const file = (id: string, release: string | null, cluster = 0): Arrival =>
    arrival({
      id,
      path: `/d/${id}.mkv`,
      file: `${id}.mkv`,
      release,
      cluster,
      detached: cluster > 0,
    });

  it('groups by release, keeps the order, and lists each other series apart', () => {
    const groups = groupReleases([
      file('a', '/d/Pack'),
      file('b', '/d/Pack'),
      file('x', '/d/Pack', 1),
      file('y', '/d/Pack', 2),
      file('z', '/d/Pack', 1),
      file('c', '/d/Other'),
    ]);
    expect(
      groups.map((g) => [
        g.name,
        g.files.map((f) => f.id),
        g.others.map((o) => [o.cluster, o.files.map((f) => f.id)]),
      ]),
    ).toEqual([
      [
        'Pack',
        ['a', 'b'],
        [
          [1, ['x', 'z']],
          [2, ['y']],
        ],
      ],
      ['Other', ['c'], []],
    ]);
  });

  it('keeps the same folder sent twice as two groups, one per job', () => {
    const groups = groupReleases([
      { ...file('a', '/d/Pack'), jobId: 'j1' },
      { ...file('b', '/d/Pack'), jobId: 'j2' },
      { ...file('c', '/d/Pack'), jobId: 'j1' },
    ]);
    expect(groups.map((g) => [g.name, g.files.map((f) => f.id)])).toEqual([
      ['Pack', ['a', 'c']],
      ['Pack', ['b']],
    ]);
  });

  it('makes a group of its own of a file without a release', () => {
    expect(groupReleases([file('a', null)]).map((g) => g.name)).toEqual(['a.mkv']);
  });
});

describe('readArrivals', () => {
  const file = (jobId: string, release: string, id: string): Arrival =>
    arrival({ id, jobId, release, path: `${release}/${id}.mkv`, file: `${id}.mkv` });

  it('counts releases, not files, to read the next page', async () => {
    // Three releases of two files each; the API pages by release.
    const releases = ['/d/A', '/d/B', '/d/C'].map((release, n) => [
      file(`j${String(n)}`, release, `${release}-1`),
      file(`j${String(n)}`, release, `${release}-2`),
    ]);
    const asked: [number, number][] = [];
    const page = await readArrivals(3, (limit, offset) => {
      asked.push([limit, offset]);
      return Promise.resolve({
        total: 6,
        sources: [],
        items: releases.slice(offset, offset + Math.min(limit, 2)).flat(),
      });
    });
    expect(asked).toEqual([
      [3, 0],
      [1, 2],
    ]);
    expect(page.items).toHaveLength(6);
  });
});

describe('startPlanned', () => {
  it('asks each job once for its own files, with no new choice', async () => {
    const calls: [string, unknown][] = [];
    const post = <T>(url: string, body?: unknown): Promise<T> => {
      calls.push([url, body]);
      return Promise.resolve(undefined as T);
    };
    const started = await startPlanned(
      [
        { id: 'a', jobId: 'j1' },
        { id: 'b', jobId: 'j2' },
        { id: 'c', jobId: 'j1' },
      ],
      post,
    );
    expect(started).toBe(3);
    expect(calls).toEqual([
      ['/api/plans/j1/execute', { entries: ['a', 'c'] }],
      ['/api/plans/j2/execute', { entries: ['b'] }],
    ]);
  });

  it('does nothing for no file', async () => {
    expect(await startPlanned([], () => Promise.reject(new Error('no call')))).toBe(0);
  });
});
