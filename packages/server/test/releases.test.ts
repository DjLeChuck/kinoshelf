import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, harness, makeDir, put, type Harness } from './harness.js';

afterEach(cleanup);

interface EntryBody {
  id: string;
  path: string;
  classification: string;
  resolution: string | null;
  release: string | null;
  detached: boolean;
}

const ZORP = {
  kind: 'series',
  id: { provider: 'tmdb', id: 77 },
  title: 'Zorp',
  year: 2010,
};

/** A folder of three episodes of a show nobody knows, and one of another show dropped in it. */
async function scan(h: Harness) {
  const source = await makeDir();
  for (const name of [
    'Pack/Zorp.S01E01.mkv',
    'Pack/Zorp.S01E02.mkv',
    'Pack/Zorp.S01E03.mkv',
    'Pack/Quux.S01E01.mkv',
  ]) {
    await put(join(source, name));
  }
  const jobId = (await h.request('POST', '/api/jobs', { path: source })).json<{ id: string }>().id;
  await h.app.jobs.idle();
  const entries = async () =>
    (await h.request('GET', `/api/jobs/${jobId}/entries`)).json<EntryBody[]>();
  const named = async (name: string): Promise<EntryBody> => {
    const entry = (await entries()).find((e) => e.path.endsWith(name));
    if (!entry) {
      throw new Error(`no entry for ${name}`);
    }
    return entry;
  };
  return { entries, named };
}

describe('validating a release', () => {
  it('keeps the episodes of a folder together and sets the other show aside', async () => {
    const h = await harness();
    const { entries } = await scan(h);
    const all = await entries();
    expect(new Set(all.map((e) => e.release)).size).toBe(1);
    expect(all.filter((e) => e.detached).map((e) => e.path.split('/').pop())).toEqual([
      'Quux.S01E01.mkv',
    ]);
  });

  it('applies one choice to the whole release, detached episodes excepted', async () => {
    const h = await harness();
    const { named } = await scan(h);

    const response = await h.request(
      'POST',
      `/api/entries/${(await named('Zorp.S01E01.mkv')).id}/match`,
      ZORP,
    );
    expect(response.json<{ followers: string[] }>().followers).toHaveLength(2);

    expect((await named('Zorp.S01E02.mkv')).classification).toBe('to-rename');
    expect((await named('Zorp.S01E03.mkv')).classification).toBe('to-rename');
    expect((await named('Quux.S01E01.mkv')).classification).toBe('unrecognized');
  });

  it('leaves the rest of the release alone when asked', async () => {
    const h = await harness();
    const { named } = await scan(h);
    await h.request('POST', `/api/entries/${(await named('Zorp.S01E01.mkv')).id}/match`, {
      ...ZORP,
      onlyThis: true,
    });
    expect((await named('Zorp.S01E01.mkv')).classification).toBe('to-rename');
    expect((await named('Zorp.S01E02.mkv')).classification).toBe('unrecognized');
  });

  it('sets the whole release aside, or just the file', async () => {
    const h = await harness();
    const { named } = await scan(h);
    await h.request('POST', `/api/entries/${(await named('Quux.S01E01.mkv')).id}/ignore`);
    expect((await named('Quux.S01E01.mkv')).resolution).toBe('ignored');
    expect((await named('Zorp.S01E01.mkv')).resolution).toBeNull();

    await h.request('POST', `/api/entries/${(await named('Zorp.S01E01.mkv')).id}/ignore`);
    expect((await named('Zorp.S01E03.mkv')).resolution).toBe('ignored');
  });

  it('tells arrivals which release a file belongs to and whether it was set aside', async () => {
    const h = await harness();
    await scan(h);
    const { items } = (await h.request('GET', '/api/arrivals')).json<{
      items: { file: string; release: string; detached: boolean }[];
    }>();
    expect(items.find((i) => i.file === 'Quux.S01E01.mkv')).toMatchObject({ detached: true });
    expect(new Set(items.map((i) => i.release)).size).toBe(1);
  });
});
