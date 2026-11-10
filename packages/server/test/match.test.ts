import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExecutionStore } from '../src/executions.js';
import { MatchTracker } from '../src/matches.js';
import {
  cleanup,
  fakeProvider,
  harness,
  jobEntries,
  makeDir,
  put,
  type Harness,
} from './harness.js';

afterEach(cleanup);

interface EntryBody {
  id: string;
  jobId: string;
  path: string;
  classification: string;
  destination: string | null;
}

const ZORP = { kind: 'series', id: { provider: 'tmdb', id: 77 }, title: 'Zorp', year: 2010 };

interface State {
  status: string;
  done?: number;
  total?: number;
  followers?: string[];
  error?: { code: string };
}

/** Series libraries that write metadata, so planning asks the provider and a test can hold it. */
async function setup(names: readonly string[]) {
  let gate: Promise<void> | undefined;
  let broken = false;
  const h = await harness({
    config: {
      libraries: [
        { id: 'films', name: 'Films', source: await makeDir(), type: 'movie' },
        { id: 'shows', name: 'Shows', source: await makeDir(), type: 'series', metadata: 'nfo' },
      ],
    },
    createProvider: () => ({
      ...fakeProvider,
      getSeriesDetails: async (id, language) => {
        await gate;
        if (broken) {
          throw new Error('the provider is down');
        }
        return fakeProvider.getSeriesDetails(id, language);
      },
    }),
  });
  const source = await makeDir();
  for (const name of names) {
    await put(join(source, name));
  }
  const jobId = (await h.request('POST', '/api/jobs', { path: source })).json<{ id: string }>().id;
  await h.app.jobs.idle();
  const entries = (): EntryBody[] => jobEntries<EntryBody>(h, jobId);
  const named = (name: string): EntryBody => {
    const entry = entries().find((e) => e.path.endsWith(name));
    if (!entry) {
      throw new Error(`no entry for ${name}`);
    }
    return entry;
  };
  return {
    h,
    jobId,
    named,
    breakProvider: (): void => {
      broken = true;
    },
    hold: (): (() => void) => {
      let open: () => void = () => undefined;
      gate = new Promise((resolve) => {
        open = resolve;
      });
      return open;
    },
  };
}

const stateOf = async (h: Harness, id: string): Promise<State> =>
  (await h.request('GET', `/api/entries/${id}/match`)).json<State>();

async function ended(h: Harness, id: string): Promise<State> {
  for (;;) {
    const state = await stateOf(h, id);
    if (state.status !== 'running') {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('a validation that runs on its own', () => {
  it('answers at once, says where it is, and refuses a second one on the same release', async () => {
    const { h, jobId, named, hold } = await setup([
      'Pack/Zorp.S01E01.mkv',
      'Pack/Zorp.S01E02.mkv',
      'Pack/Zorp.S01E03.mkv',
    ]);
    const release = hold();
    const first = named('Zorp.S01E01.mkv').id;

    const started = await h.request('POST', `/api/entries/${first}/match`, ZORP);
    expect(started.statusCode).toBe(202);
    expect(await stateOf(h, first)).toMatchObject({ status: 'running', total: 3 });

    // Another file of the release is the same work: planned twice, the last write would win.
    const again = await h.request(
      'POST',
      `/api/entries/${named('Zorp.S01E02.mkv').id}/match`,
      ZORP,
    );
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: { code: 'queue.match-in-progress' } });
    const ignored = await h.request('POST', `/api/entries/${named('Zorp.S01E03.mkv').id}/ignore`);
    expect(ignored.statusCode).toBe(409);
    // Nor can a transfer start on a plan that is being rewritten.
    const run = await h.request('POST', `/api/plans/${jobId}/execute`, {
      entries: [named('Zorp.S01E02.mkv').id],
    });
    expect(run.statusCode).toBe(409);
    expect(run.json()).toEqual({ error: { code: 'queue.entry-held' } });

    release();
    const state = await ended(h, first);
    expect(state).toMatchObject({ status: 'done' });
    expect(state.followers).toHaveLength(2);
    // Free again once it ended.
    expect((await h.request('POST', `/api/entries/${first}/match`, ZORP)).statusCode).toBe(202);
    await ended(h, first);
  });

  it('keeps the cause of a failure where the client reads it, and frees the release', async () => {
    const { h, named, breakProvider } = await setup(['Pack/Zorp.S01E01.mkv']);
    const id = named('Zorp.S01E01.mkv').id;
    breakProvider();
    expect((await h.request('POST', `/api/entries/${id}/match`, ZORP)).statusCode).toBe(202);
    expect(await ended(h, id)).toMatchObject({
      status: 'failed',
      error: { code: 'internal.unexpected' },
    });
    // Nothing was recorded, and it can be tried again.
    expect(named('Zorp.S01E01.mkv').classification).toBe('unrecognized');
    expect((await h.request('POST', `/api/entries/${id}/match`, ZORP)).statusCode).toBe(202);
    await ended(h, id);
    expect((await h.request('GET', '/api/entries/nope/match')).statusCode).toBe(404);
  });

  it('refuses to change the plan of a file a transfer is waiting for', async () => {
    const { h, jobId, named } = await setup(['Pack/Zorp.S01E01.mkv', 'Pack/Zorp.S01E02.mkv']);
    const first = named('Zorp.S01E01.mkv').id;
    await h.match(first, ZORP);
    // Queued and never run: the runner is not told.
    new ExecutionStore(h.database).create(jobId, [first, named('Zorp.S01E02.mkv').id]);

    for (const id of [first, named('Zorp.S01E02.mkv').id]) {
      const refused = await h.request('POST', `/api/entries/${id}/match`, ZORP);
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toEqual({ error: { code: 'queue.entry-held' } });
    }
    const ignored = await h.request('POST', `/api/entries/${first}/ignore`);
    expect(ignored.statusCode).toBe(409);
  });

  it('plans the release in one go, so two versions of an episode are told apart together', async () => {
    const { h, named } = await setup([
      'Pack/Zorp.S01E01.1080p.WEB-DL.mkv',
      'Pack/Zorp.S01E01.1080p.BluRay.mkv',
      'Pack/Zorp.S01E02.1080p.WEB-DL.mkv',
    ]);
    const answer = await h.match(named('Zorp.S01E01.1080p.WEB-DL.mkv').id, ZORP);
    expect(answer.statusCode).toBe(200);
    const [a, b] = [
      named('Zorp.S01E01.1080p.WEB-DL.mkv').destination,
      named('Zorp.S01E01.1080p.BluRay.mkv').destination,
    ];
    expect(a).not.toBeNull();
    expect(a).not.toBe(b);
  });
});

describe('MatchTracker', () => {
  it('locks a release until it ends, and keeps how it ended', () => {
    const moved: boolean[] = [];
    const tracker = new MatchTracker((ended) => moved.push(ended));
    tracker.begin('a', 'release', 2);
    expect(() => {
      tracker.begin('b', 'release', 1);
    }).toThrow();
    tracker.progress('a', 1, 'x.mkv');
    expect(tracker.get('a')).toMatchObject({ status: 'running', done: 1, current: 'x.mkv' });
    tracker.finish('a', 'release', ['b']);
    expect(tracker.get('a')).toEqual({ status: 'done', followers: ['b'] });
    expect(tracker.locked('release')).toBe(false);
    tracker.begin('b', 'release', 1);
    tracker.fail('b', 'release', new Error('boom'));
    expect(tracker.get('b')).toEqual({ status: 'failed', error: { code: 'internal.unexpected' } });
    expect(moved.at(-1)).toBe(true);
  });
});
