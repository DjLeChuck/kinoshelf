import { describe, expect, it } from 'vitest';
import { GuessitParser, pictureSize, versionLabel, versionLabels } from '../src/index.js';

const parse = (name: string) => new GuessitParser().parse(name);

describe('versionLabel', () => {
  it('is the picture size by default', () => {
    expect(versionLabel(parse('Dune.2021.2160p.UHD.BluRay.x265-GRP.mkv'))).toBe('2160p');
  });

  it('adds the source, then the group, level by level', () => {
    const parsed = parse('Dune.2021.2160p.UHD.BluRay.x265-GRP.mkv');
    expect(versionLabel(parsed, 1)).toBe('2160p Ultra HD Blu-ray');
    expect(versionLabel(parsed, 2)).toBe('2160p Ultra HD Blu-ray GRP');
  });

  it('has no label without a picture size', () => {
    expect(versionLabel(parse('Film.2020.BluRay-GRP.mkv'))).toBeUndefined();
  });
});

describe('versionLabels', () => {
  it('stops at the size when it tells the files apart', () => {
    expect(
      versionLabels([
        parse('Nightbitch.2024.1080p.WEB-DL-GRP.mkv'),
        parse('Nightbitch.2024.2160p.WEB-DL-GRP.mkv'),
      ]),
    ).toEqual(['1080p', '2160p']);
  });

  it('goes on to the source when two files share a size', () => {
    expect(
      versionLabels([parse('Film.2020.1080p.BluRay-A.mkv'), parse('Film.2020.1080p.WEB-DL-A.mkv')]),
    ).toEqual(['1080p Blu-ray', '1080p Web']);
  });

  it('goes on to the group when the source is the same too', () => {
    expect(
      versionLabels([
        parse('Film.2020.1080p.BluRay-AAA.mkv'),
        parse('Film.2020.1080p.BluRay-BBB.mkv'),
      ]),
    ).toEqual(['1080p Blu-ray AAA', '1080p Blu-ray BBB']);
  });

  it('gives null to files nothing can tell apart', () => {
    expect(
      versionLabels([
        parse('Film.2020.1080p.BluRay-AAA.mkv'),
        parse('Film.2020.1080p.BluRay-AAA.mkv'),
        parse('Film.2020.720p.BluRay-AAA.mkv'),
      ]),
    ).toEqual([null, null, '720p Blu-ray AAA']);
  });

  it('keeps a file without size unlabelled', () => {
    expect(versionLabels([parse('Film.2020.mkv'), parse('Film.2020.1080p.mkv')])).toEqual([
      undefined,
      '1080p',
    ]);
  });
});

describe('pictureSize', () => {
  it.each([
    [3840, 2160, '2160p'],
    [3840, 1600, '2160p'],
    [4096, 2160, '2160p'],
    [1920, 1080, '1080p'],
    [1920, 800, '1080p'],
    [1280, 720, '720p'],
    [1280, 536, '720p'],
    [720, 576, '576p'],
    [640, 480, '480p'],
    [2560, 1440, '1440p'],
  ])('calls a %ix%i frame %s', (width, height, expected) => {
    expect(pictureSize(width, height)).toBe(expected);
  });
});
