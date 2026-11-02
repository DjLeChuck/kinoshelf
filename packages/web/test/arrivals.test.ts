import { describe, expect, it } from 'vitest';
import { en, fr } from '@kinoshelf/i18n';
import {
  STATUS_LABEL,
  folderOf,
  posterUrl,
  groupReleases,
  releaseName,
  sameCandidate,
  statusOf,
  titleGuess,
  toMatchBody,
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
  detached: false,
  state: 'review',
  kind: 'movie',
  resolution: '1080p',
  createdAt: null,
  sourceId: 'dl',
  destination: { libraryId: 'films', remembered: false },
  destinationOptions: [{ id: 'films', name: 'Films' }],
  reason: null,
  candidates: [],
  plannedPath: null,
  conflicts: [],
  error: null,
  ...over,
});

describe('statusOf', () => {
  const conflict = [{ reason: 'destination-exists', path: '/x', detail: null }];
  it.each([
    [{}, 'to-validate'],
    [{ state: 'unrecognized' }, 'nothing-found'],
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
    expect(posterUrl('abc.jpg', 'w154')).toBe('/api/images/w154/abc.jpg');
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
  const recorder = (answers: (url: string) => unknown) => {
    const calls: { url: string; body: unknown }[] = [];
    const post = <T>(url: string, body?: unknown): Promise<T> => {
      calls.push({ url, body });
      const answer = answers(url);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as T);
    };
    return { calls, post };
  };
  const renamed = { classification: 'to-rename', conflicts: [] };

  it('matches, then queues the transfer of the file', async () => {
    const { calls, post } = recorder((url) => (url.includes('/match') ? renamed : {}));
    expect(await validate(arrival(), { candidate: dune }, post)).toEqual({
      status: 'started',
      followed: 0,
    });
    expect(calls.map((c) => c.url)).toEqual(['/api/entries/e1/match', '/api/plans/j1/execute']);
    expect(calls[0]?.body).not.toHaveProperty('score');
    expect(calls[1]?.body).toEqual({ entries: ['e1'] });
  });

  it('does not transfer a file the plan put in conflict, and says why', async () => {
    const conflicts = [{ reason: 'destination-exists', path: '/x', detail: null }];
    const { calls, post } = recorder(() => ({ classification: 'conflict', conflicts }));
    expect(await validate(arrival(), { candidate: dune }, post)).toEqual({
      status: 'conflict',
      conflicts,
    });
    expect(calls).toHaveLength(1);
  });

  it('transfers the rest of the release along, and says how many went', async () => {
    const { calls, post } = recorder((url) =>
      url.includes('/match') ? { ...renamed, followers: ['e2', 'e3'] } : {},
    );
    expect(await validate(arrival(), { candidate: dune }, post)).toEqual({
      status: 'started',
      followed: 2,
    });
    expect(calls[1]?.body).toEqual({ entries: ['e1', 'e2', 'e3'] });
  });

  it('sends only the choices that differ from the defaults', async () => {
    const { calls, post } = recorder(() => renamed);
    await validate(arrival(), { candidate: dune }, post);
    await validate(
      arrival(),
      { candidate: dune, libraryId: 'uhd', rememberDestination: true },
      post,
    );
    const bodies = calls.filter((c) => c.url.includes('/match')).map((c) => c.body);
    expect(bodies[0]).not.toHaveProperty('libraryId');
    expect(bodies[0]).not.toHaveProperty('rememberDestination');
    expect(bodies[1]).toMatchObject({
      libraryId: 'uhd',
      rememberDestination: true,
    });
  });

  it('gives the error back when the transfer cannot be queued', async () => {
    const failure = new Error('down');
    const { post } = recorder((url) => (url.includes('/match') ? renamed : failure));
    await expect(validate(arrival(), { candidate: dune }, post)).rejects.toBe(failure);
  });
});

describe('titleGuess', () => {
  it.each([
    ['Dune.2021.1080p.WEB-DL.mkv', { title: 'Dune', year: '2021' }],
    ['Blade_Runner_2049.2017.mkv', { title: 'Blade Runner 2049', year: '2017' }],
    ['The.Office.US.S02E05.720p.mkv', { title: 'The Office US' }],
    ['Mystery.Footage.mkv', { title: 'Mystery Footage' }],
  ])('%s', (release, expected) => {
    expect(titleGuess(release)).toEqual(expected);
  });
});

describe('groupReleases', () => {
  const file = (id: string, release: string | null, detached = false): Arrival =>
    arrival({ id, path: `/d/${id}.mkv`, file: `${id}.mkv`, release, detached });

  it('groups by release, keeps the order, and lists the detached apart', () => {
    const groups = groupReleases([
      file('a', '/d/Pack'),
      file('b', '/d/Pack'),
      file('x', '/d/Pack', true),
      file('c', '/d/Other'),
    ]);
    expect(
      groups.map((g) => [g.name, g.files.map((f) => f.id), g.detached.map((f) => f.id)]),
    ).toEqual([
      ['Pack', ['a', 'b'], ['x']],
      ['Other', ['c'], []],
    ]);
  });

  it('makes a group of its own of a file without a release', () => {
    expect(groupReleases([file('a', null)]).map((g) => g.name)).toEqual(['a.mkv']);
  });
});
