import { chmod, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_ENTRIES } from '../src/browse.js';
import { cleanup, harness, makeDir, put } from './harness.js';

afterEach(cleanup);

interface Listing {
  path: string;
  parent: string | null;
  entries: { name: string; kind: string }[];
  truncated: boolean;
}

const list = async (query: string) => {
  const h = await harness();
  return h.request('GET', `/api/fs?${query}`);
};

describe('GET /api/fs', () => {
  it('lists sub-folders only, folders sorted without regard to case, hidden ones left out', async () => {
    const root = await makeDir();
    await mkdir(join(root, 'series'));
    await mkdir(join(root, 'Films'));
    await mkdir(join(root, '.cache'));
    await put(join(root, 'notes.txt'), 'x');

    const response = await list(`path=${encodeURIComponent(root)}`);
    expect(response.statusCode).toBe(200);
    expect(response.json<Listing>()).toEqual({
      path: root,
      parent: join(root, '..').replace(/\/$/, '') || '/',
      entries: [
        { name: 'Films', kind: 'directory' },
        { name: 'series', kind: 'directory' },
      ],
      truncated: false,
    });
  });

  it('adds the YAML files, after the folders, when asked', async () => {
    const root = await makeDir();
    await mkdir(join(root, 'zz'));
    await put(join(root, 'mine.yaml'), 'x');
    await put(join(root, 'other.YML'), 'x');
    await put(join(root, 'readme.md'), 'x');

    const entries = (await list(`path=${encodeURIComponent(root)}&files=yaml`)).json<Listing>()
      .entries;
    expect(entries).toEqual([
      { name: 'zz', kind: 'directory' },
      { name: 'mine.yaml', kind: 'file' },
      { name: 'other.YML', kind: 'file' },
    ]);
  });

  it('shows a symlink as its target and drops a broken one', async () => {
    const root = await makeDir();
    const target = join(root, 'real');
    await mkdir(target);
    await symlink(target, join(root, 'link'));
    await symlink(join(root, 'nowhere'), join(root, 'broken'));

    const names = (await list(`path=${encodeURIComponent(root)}`)).json<Listing>().entries;
    expect(names.map((e) => e.name)).toEqual(['link', 'real']);
    expect(names.every((e) => e.kind === 'directory')).toBe(true);
  });

  it('reads `..` for what it is, and reports no parent at the root', async () => {
    const root = await makeDir();
    await mkdir(join(root, 'a'));
    const viaDots = (
      await list(`path=${encodeURIComponent(join(root, 'a', '..'))}`)
    ).json<Listing>();
    expect(viaDots.path).toBe(root);
    expect((await list('path=%2F')).json<Listing>().parent).toBeNull();
  });

  it('cuts a huge folder and says so', async () => {
    const root = await makeDir();
    await Promise.all(
      Array.from({ length: MAX_ENTRIES + 5 }, (_, i) =>
        mkdir(join(root, `d${String(i).padStart(5, '0')}`)),
      ),
    );
    const listing = (await list(`path=${encodeURIComponent(root)}`)).json<Listing>();
    expect(listing.entries).toHaveLength(MAX_ENTRIES);
    expect(listing.truncated).toBe(true);
  });

  it('refuses a relative path, a missing folder and a file', async () => {
    const root = await makeDir();
    const file = await put(join(root, 'a.txt'), 'x');

    const relative = await list('path=media%2Ffilms');
    expect(relative.statusCode).toBe(400);
    expect(relative.json()).toEqual({ error: { code: 'fs.not-absolute' } });

    const missing = await list(`path=${encodeURIComponent(join(root, 'nope'))}`);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'fs.not-found' } });

    const notFolder = await list(`path=${encodeURIComponent(file)}`);
    expect(notFolder.statusCode).toBe(409);
    expect(notFolder.json()).toMatchObject({ error: { code: 'fs.not-a-directory' } });

    expect((await list('path=')).statusCode).toBe(400);
    expect((await list(`path=${encodeURIComponent(root)}&files=exe`)).statusCode).toBe(400);
  });

  it.skipIf(process.getuid?.() === 0)('reports a folder it may not read', async () => {
    const root = await makeDir();
    const locked = join(root, 'locked');
    await mkdir(locked);
    await chmod(locked, 0o000);
    try {
      const response = await list(`path=${encodeURIComponent(locked)}`);
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'fs.unreadable' } });
    } finally {
      await chmod(locked, 0o700);
    }
  });

  it('is behind the API key like the rest', async () => {
    const h = await harness();
    const response = await h.app.inject({ method: 'GET', url: '/api/fs?path=%2F' });
    expect(response.statusCode).toBe(401);
  });
});
