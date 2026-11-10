import { describe, expect, it } from 'vitest';
import { countGroups, groupRows, matches, workOf, type ChangeRow } from '../src/lib/change-list.js';

const row = (id: string, group: string, extra: Partial<ChangeRow> = {}): ChangeRow => ({
  id,
  group,
  groupLabel: group,
  chips: [],
  problem: false,
  detailCount: 0,
  ...extra,
});

describe('groupRows', () => {
  const rows = [
    row('a1', 'A'),
    row('b1', 'B'),
    row('b2', 'B', { problem: true }),
    row('c1', 'C'),
    row('d1', 'D', { problem: true }),
  ];

  it('lists the groups holding a problem first, the others in their order', () => {
    expect(groupRows(rows, 'all', '').map(({ key }) => key)).toEqual(['B', 'D', 'A', 'C']);
  });

  it('keeps every row of a group in the full view', () => {
    expect(groupRows(rows, 'all', '')[0]?.rows.map(({ id }) => id)).toEqual(['b1', 'b2']);
  });

  it('keeps only the problems, and only the groups that have one, in the problems view', () => {
    const groups = groupRows(rows, 'problems', '');
    expect(groups.map(({ key }) => key)).toEqual(['B', 'D']);
    expect(groups[0]?.rows.map(({ id }) => id)).toEqual(['b2']);
    expect(groups[0]?.problems).toBe(1);
  });

  it('searches without caring for case or accents, all words required', () => {
    const found = groupRows(
      [row('x', 'g', { groupLabel: 'Élévation (2024)' }), row('y', 'h', { groupLabel: 'Dune' })],
      'all',
      'elevation 2024',
    );
    expect(found.map(({ key }) => key)).toEqual(['g']);
  });

  it('searches the names a row shows, not only its group', () => {
    const target = row('x', 'g', { before: 'dune.2021.mkv', after: 'Dune (2021).mkv' });
    expect(matches(target, 'dune.2021')).toBe(true);
    expect(matches(target, 'arrival')).toBe(false);
  });

  it('keeps a problem hidden by the search out of the problems view', () => {
    expect(groupRows(rows, 'problems', 'zzz')).toEqual([]);
  });
});

describe('countGroups', () => {
  it('counts groups, so a show of many episodes is one', () => {
    const rows = [
      row('1', 'show'),
      row('2', 'show', { problem: true }),
      row('3', 'show', { problem: true }),
      row('4', 'movie'),
    ];
    expect(countGroups(rows)).toEqual({ all: 2, problems: 1 });
  });
});

describe('workOf', () => {
  it('is the folder of a movie’s file', () => {
    expect(workOf('/lib/Dune (2021) {tmdb-1}/Dune (2021) {tmdb-1}.mkv')).toEqual({
      key: '/lib/Dune (2021) {tmdb-1}',
      name: 'Dune (2021) {tmdb-1}',
    });
  });

  it('is the show for an episode, and the show’s own files share it', () => {
    const episode = workOf('/tv/Show (2022)/Season 01/Show (2022) - s01e01.mkv');
    expect(episode).toEqual({ key: '/tv/Show (2022)', name: 'Show (2022)' });
    expect(workOf('/tv/Show (2022)/tvshow.nfo')).toEqual(episode);
    expect(workOf('/tv/Show (2022)/Specials/x.mkv')).toEqual(episode);
  });
});
