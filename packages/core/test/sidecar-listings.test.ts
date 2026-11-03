import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findSidecars } from '../src/planning/sidecars.js';
import { cleanup, makeDir, put } from './workspace.js';

afterEach(cleanup);

describe('findSidecars with a shared listing', () => {
  it('reads a folder once for all its videos, and finds each one its own files', async () => {
    const root = await makeDir();
    const one = await put(join(root, 'S01E01.mkv'));
    const two = await put(join(root, 'S01E02.mkv'));
    await put(join(root, 'S01E01.en.srt'));
    await put(join(root, 'S01E02.nfo'));

    const listings = new Map<string, Promise<string[]>>();
    const first = await findSidecars(one, undefined, listings);
    const second = await findSidecars(two, undefined, listings);

    expect(listings.size).toBe(1);
    expect([...listings.keys()]).toEqual([dirname(one)]);
    expect(first.map(({ suffix }) => suffix)).toEqual(['.en.srt']);
    expect(second.map(({ suffix }) => suffix)).toEqual(['.nfo']);
  });
});
