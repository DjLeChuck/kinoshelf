import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, harness, makeDir, put, type Harness } from './harness.js';

afterEach(cleanup);

interface EntryBody {
  id: string;
  path: string;
  classification: string;
}

interface AliasBody {
  id: number;
  kind: string;
  title: string;
  year?: number;
  work: { id: { provider: string; id: number }; title: string; year?: number };
}

// The fake provider only finds titles that start with a film it knows: a Spanish title finds none.
const DUNE = { kind: 'movie', id: { provider: 'tmdb', id: 438631 }, title: 'Dune', year: 2021 };

async function scan(h: Harness, names: readonly string[]) {
  const source = await makeDir();
  for (const name of names) {
    await put(join(source, name), name);
  }
  const jobId = (await h.request('POST', '/api/jobs', { path: source })).json<{ id: string }>().id;
  await h.app.jobs.idle();
  const entries = (await h.request('GET', `/api/jobs/${jobId}/entries`)).json<EntryBody[]>();
  const named = (name: string): EntryBody => {
    const entry = entries.find((e) => e.path.endsWith(name));
    if (!entry) {
      throw new Error(`no entry for ${name}`);
    }
    return entry;
  };
  return { jobId, named };
}

const classificationOf = async (h: Harness, jobId: string, name: string): Promise<string> => {
  const entries = (await h.request('GET', `/api/jobs/${jobId}/entries`)).json<EntryBody[]>();
  return entries.find((e) => e.path.endsWith(name))?.classification ?? 'missing';
};

describe('remembered titles', () => {
  it('learns the title of a validated file and lists it', async () => {
    const h = await harness();
    const { named } = await scan(h, ['Duna.2021.1080p.mkv']);
    expect((await h.request('GET', '/api/aliases')).json()).toEqual([]);

    await h.request('POST', `/api/queue/${named('Duna.2021.1080p.mkv').id}/match`, DUNE);

    const aliases = (await h.request('GET', '/api/aliases')).json<AliasBody[]>();
    expect(aliases).toHaveLength(1);
    expect(aliases[0]).toMatchObject({
      kind: 'movie',
      title: 'Duna',
      year: 2021,
      work: { id: { provider: 'tmdb', id: 438631 }, title: 'Dune', year: 2021 },
    });
  });

  it('matches the files waiting under the same title, and only those', async () => {
    const h = await harness();
    const { jobId, named } = await scan(h, [
      'Duna.2021.1080p.mkv',
      'Duna.2021.720p.mkv',
      'Duna.1984.mkv', // the same title, another film: not the alias
      'Mystery.Home.Video.mkv',
    ]);

    await h.request('POST', `/api/queue/${named('Duna.2021.1080p.mkv').id}/match`, DUNE);

    expect(await classificationOf(h, jobId, 'Duna.2021.720p.mkv')).toBe('to-rename');
    expect(await classificationOf(h, jobId, 'Duna.1984.mkv')).toBe('unrecognized');
    expect(await classificationOf(h, jobId, 'Mystery.Home.Video.mkv')).toBe('unrecognized');
  });

  it('says how many other files the remembered title matched', async () => {
    const h = await harness();
    const { named } = await scan(h, [
      'Duna.2021.1080p.mkv',
      'Duna.2021.720p.mkv',
      'Duna.2021.2160p.mkv',
      'Duna.1984.mkv', // another film: not counted
    ]);

    const matched = await h.request(
      'POST',
      `/api/queue/${named('Duna.2021.1080p.mkv').id}/match`,
      DUNE,
    );
    expect(matched.json<{ rematched: number }>().rematched).toBe(2);
  });

  it('counts nothing when the file is not remembered, or nothing else waits', async () => {
    const h = await harness();
    const { named } = await scan(h, ['Duna.2021.1080p.mkv', 'Duna.2021.720p.mkv']);
    const declined = await h.request(
      'POST',
      `/api/queue/${named('Duna.2021.1080p.mkv').id}/match`,
      { ...DUNE, remember: false },
    );
    expect(declined.json<{ rematched: number }>().rematched).toBe(0);

    const alone = await h.request(
      'POST',
      `/api/queue/${named('Duna.2021.720p.mkv').id}/match`,
      DUNE,
    );
    expect(alone.json<{ rematched: number }>().rematched).toBe(0);
  });

  it('does not count a file whose target is taken: it stays in the queue', async () => {
    const h = await harness();
    await put(
      join(h.destination, 'Dune (2021) {tmdb-438631}', 'Dune (2021) {tmdb-438631}.mkv'),
      'already here',
    );
    const { jobId, named } = await scan(h, ['Duna.2021.1080p.mkv', 'Duna.2021.720p.mkv']);

    const first = await h.request(
      'POST',
      `/api/queue/${named('Duna.2021.1080p.mkv').id}/match`,
      DUNE,
    );
    expect(first.json<{ rematched: number }>().rematched).toBe(0);
    expect(await classificationOf(h, jobId, 'Duna.2021.720p.mkv')).toBe('conflict');
  });

  it('lets a later scan match the title alone', async () => {
    const h = await harness();
    const first = await scan(h, ['Duna.2021.1080p.mkv']);
    await h.request('POST', `/api/queue/${first.named('Duna.2021.1080p.mkv').id}/match`, DUNE);

    const later = await scan(h, ['Duna.2021.2160p.mkv']);
    expect(await classificationOf(h, later.jobId, 'Duna.2021.2160p.mkv')).toBe('to-rename');
  });

  it('remembers nothing when asked not to', async () => {
    const h = await harness();
    const { jobId, named } = await scan(h, ['Duna.2021.1080p.mkv', 'Duna.2021.720p.mkv']);

    await h.request('POST', `/api/queue/${named('Duna.2021.1080p.mkv').id}/match`, {
      ...DUNE,
      remember: false,
    });

    expect((await h.request('GET', '/api/aliases')).json()).toEqual([]);
    expect(await classificationOf(h, jobId, 'Duna.2021.720p.mkv')).toBe('unrecognized');
  });

  it('does not remember a film chosen for a file read as an episode', async () => {
    const h = await harness();
    const { named } = await scan(h, ['Duna.S01E02.1080p.mkv']);
    await h.request('POST', `/api/queue/${named('Duna.S01E02.1080p.mkv').id}/match`, DUNE);
    expect((await h.request('GET', '/api/aliases')).json()).toEqual([]);
  });

  it('forgets a title on request, so the next scan reads it afresh', async () => {
    const h = await harness();
    const first = await scan(h, ['Duna.2021.1080p.mkv']);
    await h.request('POST', `/api/queue/${first.named('Duna.2021.1080p.mkv').id}/match`, DUNE);
    const [alias] = (await h.request('GET', '/api/aliases')).json<AliasBody[]>();

    expect((await h.request('DELETE', `/api/aliases/${alias?.id ?? 0}`)).statusCode).toBe(204);
    expect((await h.request('GET', '/api/aliases')).json()).toEqual([]);
    expect((await h.request('DELETE', `/api/aliases/${alias?.id ?? 0}`)).statusCode).toBe(404);

    const later = await scan(h, ['Duna.2021.2160p.mkv']);
    expect(await classificationOf(h, later.jobId, 'Duna.2021.2160p.mkv')).toBe('unrecognized');
  });

  it('keeps the latest choice when a title is tied twice', async () => {
    const h = await harness();
    const { named } = await scan(h, ['Duna.2021.1080p.mkv', 'Alien.1979.mkv']);
    await h.request('POST', `/api/queue/${named('Duna.2021.1080p.mkv').id}/match`, DUNE);
    // The first file left the queue; a second file with the same key is tied to another film.
    const again = await scan(h, ['Duna.2021.720p.mkv']);
    expect(
      (await h.request('GET', `/api/jobs/${again.jobId}/entries`)).json<EntryBody[]>()[0]
        ?.classification,
    ).toBe('to-rename'); // the alias already answers: nothing left to choose
    expect((await h.request('GET', '/api/aliases')).json()).toHaveLength(1);
  });
});
