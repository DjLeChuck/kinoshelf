import { describe, expect, it } from 'vitest';
import { GuessitParser } from '../src/index.js';

const parser = new GuessitParser();

describe('GuessitParser', () => {
  describe('movies', () => {
    it('parses a scene release name', () => {
      expect(parser.parse('Dune.2021.2160p.UHD.BluRay.x265-GRP.mkv')).toEqual({
        path: 'Dune.2021.2160p.UHD.BluRay.x265-GRP.mkv',
        kind: 'movie',
        title: 'Dune',
        year: 2021,
        episodes: [],
        extension: 'mkv',
        releaseGroup: 'GRP',
      });
    });

    it('uses the parent folder when the file name carries no title', () => {
      const parsed = parser.parse('Movies/Blade Runner 2049 (2017)/movie.mkv');
      expect(parsed).toMatchObject({ kind: 'movie', title: 'Blade Runner 2049', year: 2017 });
    });

    it('keeps a numeric title distinct from the year', () => {
      expect(parser.parse('Movies/2012 (2009)/2012.2009.1080p.mkv')).toMatchObject({
        title: '2012',
        year: 2009,
      });
    });

    it('ignores absolute path noise above the context depth', () => {
      const parsed = parser.parse(
        '/mnt/downloads/torrents/Dune.Part.Two.2024.1080p.WEB-DL-GRP/dune.part.two.2024.1080p.mkv',
      );
      expect(parsed).toMatchObject({ kind: 'movie', year: 2024 });
    });
  });

  describe('episodes', () => {
    it.each([
      ['Breaking Bad/Season 2/02x05.mkv', 'Breaking Bad', 2, [5]],
      [
        'Breaking Bad/Season 2/Breaking.Bad.S02E05.720p.BluRay.x264-GRP.mkv',
        'Breaking Bad',
        2,
        [5],
      ],
      ['Show Name/Season 1/e05.mkv', 'Show Name', 1, [5]],
      ['Show Name/Season 1/05.mkv', 'Show Name', 1, [5]],
      ['Show Name/Specials/Show Name - s00e13 - Special.mkv', 'Show Name', 0, [13]],
    ])('reads title, season and episode from %s', (path, title, season, episodes) => {
      expect(parser.parse(path)).toMatchObject({ kind: 'episode', title, season, episodes });
    });

    it('reads the year and episode title from folder and file names', () => {
      expect(parser.parse('Breaking Bad (2008)/Season 02/05 - Breakage.mkv')).toMatchObject({
        title: 'Breaking Bad',
        year: 2008,
        episodeTitle: 'Breakage',
      });
    });

    it.each([
      ['Doctor.Who.2005.S01E01-E02.720p.mkv', [1, 2]],
      ["Grey's Anatomy (2005)/Season 02/Grey's Anatomy (2005) - s02e01-e03.avi", [1, 2, 3]],
    ])('returns every episode of a multi-episode file: %s', (path, episodes) => {
      expect(parser.parse(path)).toMatchObject({ kind: 'episode', episodes });
    });
  });

  describe('ids already in the names', () => {
    it('extracts a Plex tmdb tag and keeps it out of the title and episode title', () => {
      const parsed = parser.parse(
        'The Bear (2022) {tmdb-136315}/Season 03/The Bear (2022) - s03e04.mkv',
      );
      expect(parsed).toMatchObject({
        kind: 'episode',
        title: 'The Bear',
        year: 2022,
        season: 3,
        episodes: [4],
        knownIds: [{ provider: 'tmdb', id: 136315 }],
      });
      expect(parsed.episodeTitle).toBeUndefined();
    });

    it('extracts a Jellyfin tmdbid tag', () => {
      expect(parser.parse('Dune (2021) [tmdbid-438631]/Dune (2021).mkv')).toMatchObject({
        kind: 'movie',
        title: 'Dune',
        knownIds: [{ provider: 'tmdb', id: 438631 }],
      });
    });

    it('strips imdb/tvdb/edition tags without reporting them as ids', () => {
      const parsed = parser.parse('Blade Runner (1982) {imdb-tt0083658} {edition-Final Cut}.mkv');
      expect(parsed).toMatchObject({ kind: 'movie', title: 'Blade Runner', year: 1982 });
      expect(parsed.knownIds).toBeUndefined();
    });

    it('deduplicates the same id found in folder and file', () => {
      const parsed = parser.parse('Dune (2021) {tmdb-438631}/Dune (2021) {tmdb-438631}.mkv');
      expect(parsed.knownIds).toEqual([{ provider: 'tmdb', id: 438631 }]);
    });
  });

  describe('unrecognized input', () => {
    it('reports date-based episodes as unknown, keeping the title', () => {
      expect(
        parser.parse('The Colbert Report (2005)/Season 08/The Colbert Report - 2011-11-15.avi'),
      ).toMatchObject({ kind: 'unknown', title: 'The Colbert Report' });
    });

    it('reports an empty path as unknown', () => {
      expect(parser.parse('')).toMatchObject({ kind: 'unknown', episodes: [] });
    });
  });

  describe('country', () => {
    it.each([
      ['The.Office.US.S03E04.720p.mkv', 'US'],
      ['The.Office.UK.S01E01.720p.mkv', 'GB'],
      ['The.Office.AU.S01E01.mkv', 'AU'],
    ])('reads the country in %s', (path, country) => {
      expect(parser.parse(path)).toMatchObject({ kind: 'episode', title: 'The Office', country });
    });

    it('leaves it out when the name carries none', () => {
      expect(parser.parse('The.Bear.S03E04.mkv').country).toBeUndefined();
    });

    it('does not mistake a title for a country when the year follows', () => {
      expect(parser.parse('Us.2019.1080p.BluRay.mkv')).toMatchObject({
        kind: 'movie',
        title: 'Us',
        year: 2019,
      });
      expect(parser.parse('Us.2019.1080p.BluRay.mkv').country).toBeUndefined();
    });
  });

  describe('conflicting readings from guessit', () => {
    // guessit-js answers `title: ["kinoshelf-cli-G", "wEL"]` here: a folder it half-reads as a
    // title. Found by chance through a random temp directory name, hence the exact input.
    const tricky = 'kinoshelf-cli-GV0wEL/Dune.mkv';

    it('falls back to the file name alone instead of trusting a non-string title', () => {
      expect(parser.parse(tricky)).toMatchObject({ kind: 'movie', title: 'Dune' });
    });

    it('never returns a title, year, episode title or group that is not the expected type', () => {
      // A fixed pseudo-random sequence, so a failure can be replayed.
      let seed = 42;
      const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648);
      const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const word = (): string =>
        Array.from({ length: 6 }, () => chars.charAt(next() % chars.length)).join('');
      const files = ['Dune.mkv', 'The.Bear.S03E04.mkv', 'zzqx.2020.mkv', '02x05.mkv'];

      for (let i = 0; i < 150; i += 1) {
        for (const file of files) {
          const parsed = parser.parse(`kinoshelf-cli-${word()}/${file}`);
          expect(
            [parsed.title, parsed.episodeTitle, parsed.releaseGroup].every(
              (v) => v === undefined || typeof v === 'string',
            ),
          ).toBe(true);
          expect(parsed.year === undefined || typeof parsed.year === 'number').toBe(true);
          expect(parsed.kind === 'unknown' || parsed.title !== undefined).toBe(true);
        }
      }
    });
  });

  it('accepts Windows separators and lowercases the extension', () => {
    expect(parser.parse('Breaking Bad\\Season 2\\02x05.MKV')).toMatchObject({
      kind: 'episode',
      season: 2,
      episodes: [5],
      extension: 'mkv',
    });
  });

  it('honors a smaller context depth', () => {
    const shallow = new GuessitParser({ contextDepth: 1 });
    expect(shallow.parse('Breaking Bad/Season 2/02x05.mkv').title).not.toBe('Breaking Bad');
  });
});
