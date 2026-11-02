import { describe, expect, it } from 'vitest';
import { clusterRelease, voteRelease, type ParsedMedia } from '../src/index.js';

const episode = (title: string, extra: Partial<ParsedMedia> = {}): ParsedMedia => ({
  path: `${title}.mkv`,
  kind: 'episode',
  title,
  season: 1,
  episodes: [1],
  ...extra,
});

describe('voteRelease', () => {
  it('keeps every episode when the folder names one series', () => {
    const vote = voteRelease([episode('Hells Kitchen'), episode('Hells Kitchen')]);
    expect(vote).toEqual({ agree: [0, 1], detached: [] });
  });

  it('follows the series most episodes name, whatever the order', () => {
    const vote = voteRelease([episode('Quux'), episode('Zorp'), episode('Zorp')]);
    expect(vote).toEqual({ agree: [1, 2], detached: [0] });
  });

  it('tolerates spelling variants of one title, not another show', () => {
    const vote = voteRelease([episode('Friends'), episode('Friend'), episode('Lost Girl')]);
    expect(vote.agree).toEqual([0, 1]);
    expect(vote.detached).toEqual([2]);
    expect(voteRelease([episode('Lost'), episode('Lost Girl')]).detached).toHaveLength(1);
  });

  it('counts variants together: two spellings outvote one other show', () => {
    const vote = voteRelease([
      episode('Hells Kitchen'),
      episode("Hell's Kitchen"),
      episode('Dark'),
    ]);
    expect(vote).toEqual({ agree: [0, 1], detached: [2] });
  });

  it('sets aside a country the others do not share', () => {
    const vote = voteRelease([
      episode('The Office', { country: 'US' }),
      episode('The Office', { country: 'US' }),
      episode('The Office', { country: 'GB' }),
    ]);
    expect(vote).toEqual({ agree: [0, 1], detached: [2] });
  });

  it('takes a country on one side only for no information', () => {
    const vote = voteRelease([
      episode('The Office', { country: 'US' }),
      episode('The Office'),
      episode('The Office'),
    ]);
    expect(vote.detached).toEqual([]);
  });

  it('breaks a tie for the first seen', () => {
    expect(voteRelease([episode('Zorp'), episode('Quux')])).toEqual({ agree: [0], detached: [1] });
  });
});

describe('clusterRelease', () => {
  it('groups every series of a folder, the main one first', () => {
    const clusters = clusterRelease([
      episode('Quux'),
      episode('Zorp'),
      episode('Zorp'),
      episode('Quux'),
      episode('Zorp'),
      episode('Lone'),
    ]);
    expect(clusters).toEqual([[1, 2, 4], [0, 3], [5]]);
  });

  it('is one group for a folder of one series', () => {
    expect(clusterRelease([episode('Zorp'), episode('Zorp')])).toEqual([[0, 1]]);
  });

  it('places every episode in exactly one group', () => {
    const titles = ['A one', 'B two', 'C three', 'A one', 'D four', 'C three'];
    const clusters = clusterRelease(titles.map((title) => episode(title)));
    expect(clusters.flat().sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
