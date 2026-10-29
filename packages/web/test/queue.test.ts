import { describe, expect, it } from 'vitest';
import { en, fr } from '@kinoshelf/i18n';
import {
  STATUS_LABEL,
  episodeLabel,
  folderOf,
  pickSelection,
  posterUrl,
  releaseName,
  sameCandidate,
  statusOf,
  toMatchBody,
  validate,
  type Candidate,
  type QueueEntry,
} from '../src/lib/queue.js';

const entry = (over: Partial<QueueEntry> = {}): QueueEntry => ({
  id: 'e1',
  jobId: 'j1',
  path: '/downloads/Dune.2021.1080p/Dune.2021.1080p.mkv',
  classification: 'ambiguous',
  resolution: null,
  parsed: { kind: 'movie', episodes: [] },
  reason: null,
  candidates: [],
  destination: null,
  conflicts: [],
  error: null,
  ...over,
});

describe('statusOf', () => {
  it.each([
    [{ classification: 'ambiguous' }, 'to-validate'],
    [{ classification: 'unrecognized' }, 'nothing-found'],
    [{ classification: 'conflict' }, 'conflict'],
    [{ classification: 'to-rename', resolution: 'failed' }, 'failed'],
    // A transfer that failed after a conflict is first a failure.
    [{ classification: 'conflict', resolution: 'failed' }, 'failed'],
  ] as const)('%j is %s', (over, expected) => {
    expect(statusOf(entry(over))).toBe(expected);
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

describe('candidates', () => {
  const dune: Candidate = {
    kind: 'movie',
    id: { provider: 'tmdb', id: 438631 },
    title: 'Dune',
    originalTitle: 'Dune',
    year: 2021,
    score: 91,
  };

  it('drops the score from what is posted back', () => {
    expect(toMatchBody(dune)).not.toHaveProperty('score');
    expect(toMatchBody(dune)).toMatchObject({ title: 'Dune', year: 2021 });
  });

  it('tells two candidates apart by kind and id: a movie and a series may share an id', () => {
    expect(sameCandidate(dune, toMatchBody(dune))).toBe(true);
    expect(sameCandidate(dune, { ...dune, kind: 'series' })).toBe(false);
  });
});

describe('episodeLabel', () => {
  it.each([
    [{ kind: 'episode', season: 2, episodes: [5] }, 'S02E05'],
    [{ kind: 'episode', season: 2, episodes: [5, 6] }, 'S02E05-E06'],
    [{ kind: 'episode', season: 2, episodes: [] }, 'S02'],
    [{ kind: 'movie', episodes: [] }, undefined],
  ])('%j reads %s', (parsed, expected) => {
    expect(episodeLabel(parsed)).toBe(expected);
  });
});

describe('pickSelection', () => {
  const list = [entry({ id: 'a' }), entry({ id: 'b' })];

  it('keeps the open file while it is in the queue, else falls to the first', () => {
    expect(pickSelection(list, 'b')).toBe('b');
    expect(pickSelection(list, 'gone')).toBe('a');
    expect(pickSelection(list, undefined)).toBe('a');
    expect(pickSelection([], 'a')).toBeUndefined();
  });
});

describe('validate', () => {
  const dune: Candidate = {
    kind: 'movie',
    id: { provider: 'tmdb', id: 438631 },
    title: 'Dune',
    originalTitle: 'Dune',
    score: 91,
  };

  const recorder = (answers: (url: string) => unknown) => {
    const calls: { url: string; body: unknown }[] = [];
    const post = <T>(url: string, body?: unknown): Promise<T> => {
      calls.push({ url, body });
      const answer = answers(url);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as T);
    };
    return { calls, post };
  };

  it('matches, then queues the transfer of that file alone', async () => {
    const { calls, post } = recorder((url) =>
      url.includes('/match') ? entry({ classification: 'to-rename' }) : {},
    );
    expect(await validate(entry(), dune, post)).toEqual({ status: 'started' });
    expect(calls.map((c) => c.url)).toEqual(['/api/queue/e1/match', '/api/plans/j1/execute']);
    expect(calls[0]?.body).not.toHaveProperty('score');
    expect(calls[1]?.body).toEqual({ entries: ['e1'] });
  });

  it('does not transfer a file the plan put in conflict', async () => {
    const { calls, post } = recorder(() => entry({ classification: 'conflict' }));
    const outcome = await validate(entry(), dune, post);
    expect(outcome.status).toBe('conflict');
    expect(calls).toHaveLength(1);
  });

  it('gives the error back when the transfer cannot be queued', async () => {
    const failure = new Error('down');
    const { post } = recorder((url) =>
      url.includes('/match') ? entry({ classification: 'to-rename' }) : failure,
    );
    await expect(validate(entry(), dune, post)).rejects.toBe(failure);
  });
});
