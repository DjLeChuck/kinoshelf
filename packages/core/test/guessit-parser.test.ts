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

  describe('titles that are a year', () => {
    it.each([
      ['1923.S02E01.720p.x264-FENiX.mkv', '1923', undefined],
      ['1923 - S02E01 - Title.mkv', '1923', undefined],
      ['1923.2022.S01E03.1080p.WEB.mkv', '1923', 2022],
      ['1883/Season 1/1883 - 1x03.mkv', '1883', undefined],
    ])('reads the title and the year of %s apart', (path, title, year) => {
      const parsed = parser.parse(path);
      expect(parsed).toMatchObject({ kind: 'episode', title });
      expect(parsed.year).toBe(year);
    });

    it('still reads a year inside a movie title as part of it', () => {
      expect(parser.parse('Blade.Runner.2049.2017.mkv')).toMatchObject({
        kind: 'movie',
        title: 'Blade Runner 2049',
        year: 2017,
      });
      expect(parser.parse('2012.2009.1080p.BluRay.mkv')).toMatchObject({
        kind: 'movie',
        title: '2012',
        year: 2009,
      });
    });
  });

  describe('volumes', () => {
    it.each([
      ['Kill Bill Vol 2 (2004)/Kill.Bill.Vol.2.2004.1080p.mp4', 2],
      ['Kill.Bill.Volume.1.2003.mkv', 1],
    ])('keeps the volume of %s', (path, volume) => {
      expect(parser.parse(path)).toMatchObject({ kind: 'movie', title: 'Kill Bill', volume });
    });

    it('reads a part as a volume, when guessit sets it aside', () => {
      expect(
        parser.parse('Harry.Potter.And.The.Deathly.Hallows.Part.2.2011.1080p.mkv'),
      ).toMatchObject({ kind: 'movie', title: 'Harry Potter And The Deathly Hallows', volume: 2 });
    });

    it('leaves a part that stays in the title to the title', () => {
      expect(parser.parse('Dune.Part.Two.2024.mkv')).toMatchObject({ title: 'Dune Part Two' });
      expect(parser.parse('Dune.Part.Two.2024.mkv').volume).toBeUndefined();
    });

    it('has none for a film that names no volume', () => {
      expect(parser.parse('Dune.2021.2160p.mkv').volume).toBeUndefined();
    });
  });

  describe('bilingual titles', () => {
    it('reads each language of `A-B` as another reading of the title', () => {
      expect(
        parser.parse('Anatomy.Of.A.Fall-Anatomie.d.une.chute--2023-720p-x265.mkv'),
      ).toMatchObject({
        title: 'Anatomy Of A Fall-Anatomie d une chute',
        otherTitles: ['Anatomy Of A Fall', 'Anatomie d une chute'],
      });
    });

    it.each([
      'Spider-Man.2002.1080p.mkv',
      'X-Men.Days.Of.Future.Past.2014.1080p.mkv',
      'Mission.Impossible.2.2000.mkv',
    ])('leaves a hyphenated word alone in %s', (path) => {
      expect(parser.parse(path).otherTitles).toBeUndefined();
    });
  });

  describe('movie subtitles', () => {
    it.each([
      [
        'Thor - Le Monde des ténèbres (2013)/Thor - Le Monde des ténèbres (2013) 1080p AC3.mkv',
        'Thor',
        'Le Monde des ténèbres',
      ],
      [
        "Divergente 2 - L'Insurrection (2015)/Divergente 2 - L'Insurrection (2015) 1080p.mkv",
        'Divergente 2',
        "L'Insurrection",
      ],
      ['Dune - Part Two (2024)/Dune - Part Two (2024).mkv', 'Dune', 'Part Two'],
    ])('keeps the part after the dash of %s', (path, title, subtitle) => {
      expect(parser.parse(path)).toMatchObject({ kind: 'movie', title, subtitle });
    });

    it('has none when there is no dash', () => {
      expect(parser.parse('Dune.2021.2160p.mkv').subtitle).toBeUndefined();
    });

    it('does not turn an episode title into a subtitle', () => {
      expect(parser.parse('Show/Season 1/Show - S01E02 - Pilot.mkv').subtitle).toBeUndefined();
    });
  });

  describe('numbers that are not an episode', () => {
    it('reads Blade Runner 2049 as a movie, not as season 20 episode 49', () => {
      const parsed = parser.parse(
        'Blade Runner 2049 - Special Edition (2017)/Blade Runner 2049 - Special Edition (2017) 1080p AC3.mkv',
      );
      expect(parsed).toMatchObject({ kind: 'movie', title: 'Blade Runner 2049', year: 2017 });
      expect(parsed.season).toBeUndefined();
      expect(parsed.episodes).toEqual([]);
    });

    it('does not take a year for a season', () => {
      const mulan = parser.parse(
        "Mulan 2 (la mission de l'Empereur) (2004)/Mulan 2 (la mission de l'Empereur) (2004) 1080p AC3.mkv",
      );
      expect(mulan).toMatchObject({ kind: 'movie', year: 2004 });
      expect(mulan.season).toBeUndefined();

      // A real marker with an impossible season: not enough to know which episode it is.
      expect(parser.parse('Firefly (2002)/Firefly.ep00_Special_Features.avi').kind).toBe('unknown');
    });

    it('leaves the type unknown when a bare number could be S01E16 or absolute episode 116', () => {
      const parsed = parser.parse(
        'Dragon Ball/Dragon Ball French 116 Kame-sennin est en vie !.mkv',
      );
      expect(parsed.kind).toBe('unknown');
      expect(parsed.episodes).toEqual([]);
      expect(parsed.season).toBeUndefined();
      expect(parser.parse('Show/Show 116.mkv').kind).toBe('unknown');
    });

    it('still reads an explicit episode whose digits look like a year', () => {
      expect(parser.parse('Show/Season 20/Show - S20E49 - 1080p.mkv')).toMatchObject({
        kind: 'episode',
        season: 20,
        episodes: [49],
      });
      expect(parser.parse('Show/Show.20x49.mkv')).toMatchObject({ kind: 'episode', season: 20 });
    });
  });

  describe('a folder that hides the real title', () => {
    it('prefers the file name when the folder was read as the title', () => {
      expect(
        parser.parse('Lego Ninjago/Saison 11/new/Ninjago_S12E02_l-ile-dyer.mkv'),
      ).toMatchObject({
        kind: 'episode',
        title: 'Ninjago',
        season: 12,
        episodes: [2],
      });
    });

    it('keeps the year of the folder when only the title comes from the file', () => {
      expect(
        parser.parse('Fondation (2021)/Saison 01/Foundation.S01E01.MULTi.VFF.1080p.mkv'),
      ).toMatchObject({
        title: 'Foundation',
        year: 2021,
        season: 1,
        episodes: [1],
      });
    });

    it('keeps the folder title when the file names the same show with a number', () => {
      expect(
        parser.parse('Bref. (2011)/Saison 02/Bref.2-S02E02.PROPER.FRENCH.1080p.WEB.H264-FW.mkv'),
      ).toMatchObject({
        title: 'Bref',
        season: 2,
        episodes: [2],
      });
    });

    it('still takes the title from the folder when the file has none', () => {
      expect(parser.parse('Breaking Bad/Season 2/02x05.mkv')).toMatchObject({
        title: 'Breaking Bad',
      });
      expect(parser.parse('Show Name/Season 1/e05.mkv')).toMatchObject({ title: 'Show Name' });
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
      // 600 parses: close to the default 5 s on a slow CI runner.
    }, 30_000);
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
