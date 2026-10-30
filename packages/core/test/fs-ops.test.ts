import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  copyAtomic,
  ensureDirectory,
  hardlinkFile,
  moveFile,
  writeAtomic,
} from '../src/execution/fs-ops.js';
import { KinoshelfError } from '../src/index.js';
import { cleanup, crossDeviceAvailable, makeDir, put, SHM } from './workspace.js';

afterEach(cleanup);

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof KinoshelfError ? error.info.code : 'unexpected';
  }
  return undefined;
}

// The executor checks these cases before calling the primitives; the primitives must hold
// the line on their own, because that check can go stale (and is what a bad refactor drops).
describe('hardlinkFile', () => {
  it.skipIf(!crossDeviceAvailable)(
    'fails across filesystems and never falls back to copying',
    async () => {
      const [src, lib] = [await makeDir(), await makeDir(SHM)];
      const source = await put(join(src, 'a.mkv'), 'v');
      const destination = join(lib, 'a.mkv');

      expect(await codeOf(hardlinkFile(source, destination))).toBe('hardlink.cross-device');
      expect(await readdir(lib)).toEqual([]);
    },
  );

  it('never replaces an existing file', async () => {
    const dir = await makeDir();
    const source = await put(join(dir, 'a.mkv'), 'new');
    const destination = await put(join(dir, 'b.mkv'), 'old');
    expect(await codeOf(hardlinkFile(source, destination))).toBe('destination.exists');
    expect(await readFile(destination, 'utf8')).toBe('old');
  });

  it('reports a missing source', async () => {
    const dir = await makeDir();
    expect(await codeOf(hardlinkFile(join(dir, 'nope.mkv'), join(dir, 'b.mkv')))).toBe(
      'source.missing',
    );
  });
});

describe('copyAtomic', () => {
  it('leaves neither a partial file nor a temporary one when the copy fails', async () => {
    const dir = await makeDir();
    const destination = join(dir, 'out.mkv');
    expect(await codeOf(copyAtomic(join(dir, 'missing.mkv'), destination))).toBe('unexpected');
    expect(await readdir(dir)).toEqual([]);
  });

  it('never replaces an existing file and cleans up its temporary file', async () => {
    const dir = await makeDir();
    const source = await put(join(dir, 'a.mkv'), 'new');
    const destination = await put(join(dir, 'b.mkv'), 'old');
    expect(await codeOf(copyAtomic(source, destination))).toBe('destination.exists');
    expect(await readFile(destination, 'utf8')).toBe('old');
    expect((await readdir(dir)).sort()).toEqual(['a.mkv', 'b.mkv']);
  });

  it('publishes the finished file only, under hidden temporary names while writing', async () => {
    const dir = await makeDir();
    const source = await put(join(dir, 'a.mkv'), 'v');
    await copyAtomic(source, join(dir, 'b.mkv'));
    expect((await readdir(dir)).filter((n) => n.startsWith('.'))).toEqual([]);
    expect((await stat(join(dir, 'b.mkv'))).size).toBe(1);
  });
});

describe('moveFile', () => {
  it('never replaces an existing file and keeps the source', async () => {
    const dir = await makeDir();
    const source = await put(join(dir, 'a.mkv'), 'new');
    const destination = await put(join(dir, 'b.mkv'), 'old');
    expect(await codeOf(moveFile(source, destination))).toBe('destination.exists');
    expect(await readFile(destination, 'utf8')).toBe('old');
    expect(await readFile(source, 'utf8')).toBe('new');
  });

  it('reports a missing source', async () => {
    const dir = await makeDir();
    expect(await codeOf(moveFile(join(dir, 'nope'), join(dir, 'b')))).toBe('source.missing');
  });
});

describe('ensureDirectory', () => {
  it('returns only the directories it had to create, outermost first', async () => {
    const root = await makeDir();
    await ensureDirectory(join(root, 'a'));
    expect(await ensureDirectory(join(root, 'a', 'b', 'c'))).toEqual([
      join(root, 'a', 'b'),
      join(root, 'a', 'b', 'c'),
    ]);
    expect(await ensureDirectory(join(root, 'a', 'b'))).toEqual([]);
  });
});

describe('writeAtomic', () => {
  it('writes the data and leaves no temporary file', async () => {
    const dir = await makeDir();
    await writeAtomic(join(dir, 'a.nfo'), 'hello');
    expect(await readFile(join(dir, 'a.nfo'), 'utf8')).toBe('hello');
    expect(await readdir(dir)).toEqual(['a.nfo']);
  });

  it('refuses to replace an existing file and cleans up', async () => {
    const dir = await makeDir();
    await put(join(dir, 'a.nfo'), 'mine');
    await expect(writeAtomic(join(dir, 'a.nfo'), 'new')).rejects.toMatchObject({
      info: { code: 'destination.exists' },
    });
    expect(await readFile(join(dir, 'a.nfo'), 'utf8')).toBe('mine');
    expect(await readdir(dir)).toEqual(['a.nfo']);
  });
});
