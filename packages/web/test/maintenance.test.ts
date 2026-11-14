import { describe, expect, it } from 'vitest';
import { groupFolders, type TidyFolder } from '../src/lib/maintenance.js';

const folder = (path: string): TidyFolder => ({ path, status: 'would-remove', files: 1 });

describe('groupFolders', () => {
  it('groups the seasons under their show, by name, seasons in numeric order', () => {
    const groups = groupFolders(
      [
        folder('/tv/Show B (2020)/Season 10'),
        folder('/tv/Show A (2019)/Season 2'),
        folder('/tv/Show B (2020)/Season 2'),
        folder('/tv/Show A (2019)/Season 1'),
      ],
      '/tv/',
    );
    expect(groups.map(({ parent }) => parent)).toEqual(['Show A (2019)', 'Show B (2020)']);
    expect(groups[1]?.folders.map(({ path }) => path)).toEqual([
      '/tv/Show B (2020)/Season 2',
      '/tv/Show B (2020)/Season 10',
    ]);
  });

  it('keeps the folders loose in the library in a group with no parent, first', () => {
    const groups = groupFolders(
      [folder('/films/Dune (2021) - 1080p'), folder('/films/Show/Season 1')],
      '/films',
    );
    expect(groups.map(({ parent }) => parent)).toEqual(['', 'Show']);
  });
});
