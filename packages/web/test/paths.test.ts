import { describe, expect, it } from 'vitest';
import { isBelow, rescanPath } from '../src/lib/paths.js';

const SOURCE = '/media/tv';

describe('rescanPath', () => {
  it('reads the folder that holds a show’s files, whatever the seasons', () => {
    expect(
      rescanPath(
        [
          `${SOURCE}/Show (2020)/Season 01/e01.mkv`,
          `${SOURCE}/Show (2020)/Season 01/e02.mkv`,
          `${SOURCE}/Show (2020)/Season 02/e01.mkv`,
        ],
        SOURCE,
      ),
    ).toBe(`${SOURCE}/Show (2020)`);
  });

  it('reads one season on its own', () => {
    expect(
      rescanPath([`${SOURCE}/Show/Season 01/e01.mkv`, `${SOURCE}/Show/Season 01/e02.mkv`], SOURCE),
    ).toBe(`${SOURCE}/Show/Season 01`);
  });

  it('reads a movie’s folder, or the file itself when it lies loose in the library', () => {
    expect(rescanPath([`${SOURCE}/Dune (2021)/Dune.mkv`], SOURCE)).toBe(`${SOURCE}/Dune (2021)`);
    expect(rescanPath([`${SOURCE}/Dune.mkv`], SOURCE)).toBe(`${SOURCE}/Dune.mkv`);
  });

  it('offers nothing narrower than the library, or outside it', () => {
    expect(rescanPath([`${SOURCE}/a.mkv`, `${SOURCE}/b.mkv`], SOURCE)).toBeUndefined();
    expect(rescanPath([`${SOURCE}/A/e.mkv`, `${SOURCE}/B/e.mkv`], SOURCE)).toBeUndefined();
    expect(rescanPath(['/media/tv2/Show/e.mkv'], SOURCE)).toBeUndefined();
    expect(rescanPath([], SOURCE)).toBeUndefined();
  });

  it('tolerates a trailing slash on the source', () => {
    expect(rescanPath([`${SOURCE}/Show/e.mkv`], `${SOURCE}/`)).toBe(`${SOURCE}/Show`);
  });
});

describe('isBelow', () => {
  it('is strict, and does not take a sibling sharing a prefix for a child', () => {
    expect(isBelow(`${SOURCE}/Show`, SOURCE)).toBe(true);
    expect(isBelow(SOURCE, SOURCE)).toBe(false);
    expect(isBelow('/media/tv2/Show', SOURCE)).toBe(false);
  });
});
