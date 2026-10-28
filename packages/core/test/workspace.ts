import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ParsedMedia } from '../src/index.js';

const created: string[] = [];

/**
 * A fresh empty directory, removed by `cleanup`; `base` picks the filesystem it lives on. Its name
 * is fixed: the parser reads the folder name too, and a random one (`kinoshelf-test-S86e68`) can
 * look like an episode marker and flip a test now and then.
 */
export async function makeDir(base = tmpdir()): Promise<string> {
  const root = await mkdtemp(join(base, 'kinoshelf-test-'));
  created.push(root);
  const directory = join(root, 'dir');
  await mkdir(directory);
  return directory;
}

export async function cleanup(): Promise<void> {
  await Promise.all(created.splice(0).map((d) => rm(d, { recursive: true, force: true })));
}

export async function put(path: string, content = 'x'): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}

/** `/dev/shm` is a different filesystem from the temp dir here: real cross-device tests. */
export const SHM = '/dev/shm';
export const crossDeviceAvailable = ((): boolean => {
  try {
    return statSync(SHM).dev !== statSync(tmpdir()).dev;
  } catch {
    return false;
  }
})();

export const parsedMovie = (path: string, year = 2021): ParsedMedia => ({
  path,
  kind: 'movie',
  title: 'Dune',
  year,
  episodes: [],
  extension: path.split('.').pop()?.toLowerCase() ?? '',
});

export const parsedEpisode = (path: string, season: number, episodes: number[]): ParsedMedia => ({
  path,
  kind: 'episode',
  title: 'The Bear',
  season,
  episodes,
  extension: path.split('.').pop()?.toLowerCase() ?? '',
});

/** Deterministic ids for readable assertions. */
export const counter = (prefix = 'id'): (() => string) => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};
