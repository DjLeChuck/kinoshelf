import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { ParsedMedia } from '../src/index.js';

export { cleanup, makeDir, put } from '../src/testing.js';

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
