import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { renderEpisodeNfo, renderMovieNfo, renderSeriesNfo } from '../src/index.js';
import type { EpisodeInfo, MovieDetails, SeriesDetails } from '../src/index.js';

const HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n';

const movie: MovieDetails = {
  kind: 'movie',
  id: { provider: 'tmdb', id: 438631 },
  imdbId: 'tt1160419',
  title: 'Dune',
  originalTitle: 'Dune',
  tagline: 'It begins.',
  overview: 'Paul Atreides.',
  genres: ['Science Fiction', 'Adventure'],
  studios: ['Legendary Pictures'],
  countries: ['United States of America'],
  rating: { value: 7.8, votes: 12000 },
  cast: [
    { name: 'Timothée Chalamet', role: 'Paul', order: 0, profilePath: '/t.jpg' },
    { name: 'Zendaya', role: 'Chani', order: 1 },
  ],
  releaseDate: '2021-09-15',
  runtime: 155,
  directors: ['Denis Villeneuve'],
  writers: ['Jon Spaihts', 'Eric Roth'],
  collection: { name: 'Dune Collection', overview: 'Spice.' },
};

const series: SeriesDetails = {
  kind: 'series',
  id: { provider: 'tmdb', id: 1396 },
  title: 'Breaking Bad',
  originalTitle: 'Breaking Bad',
  genres: ['Drama'],
  studios: ['AMC'],
  countries: ['United States of America'],
  cast: [],
  firstAirDate: '2008-01-20',
  status: 'Ended',
  seasons: [{ season: 0, name: 'Specials' }, { season: 1 }, { season: 2, name: 'Season Two' }],
};

const ep1: EpisodeInfo = {
  season: 1,
  episode: 1,
  title: 'Pilot',
  airDate: '2008-01-20',
  overview: 'Walter.',
  runtime: 58,
  directors: ['Vince Gilligan'],
  writers: ['Vince Gilligan'],
  rating: { value: 8.1, votes: 300 },
};
const ep2: EpisodeInfo = { season: 1, episode: 2, title: "Cat's in the Bag..." };

const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
const parse = (xml: string): unknown => parser.parse(xml);
// eslint-disable-next-line @typescript-eslint/no-deprecated -- the replacement package is not in the store
const wellFormed = (xml: string): boolean => XMLValidator.validate(xml) === true;

/** Reads a value of a parsed document by path, without trusting its shape. */
function at(node: unknown, ...path: (string | number)[]): unknown {
  let current = node;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

describe('NFO writer', () => {
  it('writes a movie', () => {
    expect(renderMovieNfo(movie)).toBe(
      HEADER +
        `<movie>
    <title>Dune</title>
    <originaltitle>Dune</originaltitle>
    <ratings>
        <rating name="themoviedb" max="10" default="true">
            <value>7.80</value>
            <votes>12000</votes>
        </rating>
    </ratings>
    <plot>Paul Atreides.</plot>
    <tagline>It begins.</tagline>
    <runtime>155</runtime>
    <id>438631</id>
    <uniqueid type="tmdb" default="true">438631</uniqueid>
    <uniqueid type="imdb">tt1160419</uniqueid>
    <genre>Science Fiction</genre>
    <genre>Adventure</genre>
    <country>United States of America</country>
    <set>
        <name>Dune Collection</name>
        <overview>Spice.</overview>
    </set>
    <credits>Jon Spaihts</credits>
    <credits>Eric Roth</credits>
    <director>Denis Villeneuve</director>
    <premiered>2021-09-15</premiered>
    <year>2021</year>
    <studio>Legendary Pictures</studio>
    <actor>
        <name>Timothée Chalamet</name>
        <role>Paul</role>
        <order>0</order>
    </actor>
    <actor>
        <name>Zendaya</name>
        <role>Chani</role>
        <order>1</order>
    </actor>
</movie>
`,
    );
  });

  it('writes a series', () => {
    expect(renderSeriesNfo(series)).toBe(
      HEADER +
        `<tvshow>
    <title>Breaking Bad</title>
    <originaltitle>Breaking Bad</originaltitle>
    <showtitle>Breaking Bad</showtitle>
    <id>1396</id>
    <uniqueid type="tmdb" default="true">1396</uniqueid>
    <genre>Drama</genre>
    <country>United States of America</country>
    <premiered>2008-01-20</premiered>
    <year>2008</year>
    <status>Ended</status>
    <studio>AMC</studio>
    <namedseason number="0">Specials</namedseason>
    <namedseason number="2">Season Two</namedseason>
</tvshow>
`,
    );
  });

  it('writes a single episode', () => {
    expect(renderEpisodeNfo(series, [ep1])).toBe(
      HEADER +
        `<episodedetails>
    <title>Pilot</title>
    <showtitle>Breaking Bad</showtitle>
    <season>1</season>
    <episode>1</episode>
    <ratings>
        <rating name="themoviedb" max="10" default="true">
            <value>8.10</value>
            <votes>300</votes>
        </rating>
    </ratings>
    <plot>Walter.</plot>
    <runtime>58</runtime>
    <credits>Vince Gilligan</credits>
    <director>Vince Gilligan</director>
    <aired>2008-01-20</aired>
</episodedetails>
`,
    );
  });

  it('writes one block per episode of a multi-episode file', () => {
    expect(renderEpisodeNfo(series, [ep1, ep2])).toBe(
      renderEpisodeNfo(series, [ep1]) +
        `<episodedetails>
    <title>Cat&apos;s in the Bag...</title>
    <showtitle>Breaking Bad</showtitle>
    <season>1</season>
    <episode>2</episode>
</episodedetails>
`,
    );
  });

  it('is well-formed and parses back to the same structure', () => {
    for (const xml of [renderMovieNfo(movie), renderSeriesNfo(series)]) {
      expect(wellFormed(xml)).toBe(true);
    }
    const m = parse(renderMovieNfo(movie));
    expect(at(m, 'movie', 'title')).toBe('Dune');
    expect(at(m, 'movie', 'genre')).toEqual(['Science Fiction', 'Adventure']);
    expect(at(m, 'movie', 'uniqueid', 0, '@_type')).toBe('tmdb');
    expect(at(m, 'movie', 'uniqueid', 1, '#text')).toBe('tt1160419');
    expect(at(m, 'movie', 'actor')).toHaveLength(2);
    expect(at(m, 'movie', 'set', 'name')).toBe('Dune Collection');
    expect(at(m, 'movie', 'ratings', 'rating', '@_default')).toBe('true');
    const s = parse(renderSeriesNfo(series));
    expect(at(s, 'tvshow', 'namedseason', 1, '@_number')).toBe('2');
  });

  it('escapes markup and drops characters XML 1.0 forbids', () => {
    const xml = renderMovieNfo({
      ...movie,
      title: 'Fast & Furious <3',
      overview: 'He said "go" \'now\' \u0000\u0008\uD800ok\r\nnext',
    });
    expect(xml).toContain('<title>Fast &amp; Furious &lt;3</title>');
    expect(xml).toContain('<plot>He said &quot;go&quot; &apos;now&apos; ok\nnext</plot>');
    expect(wellFormed(xml)).toBe(true);
    expect(at(parse(xml), 'movie', 'title')).toBe('Fast & Furious <3');
  });

  it('keeps astral characters', () => {
    expect(renderMovieNfo({ ...movie, title: 'Dune 🏜' })).toContain('<title>Dune 🏜</title>');
  });

  it('omits absent and empty fields', () => {
    const bare: MovieDetails = {
      kind: 'movie',
      id: { provider: 'tmdb', id: 1 },
      title: 'X',
      originalTitle: '  ',
      overview: '',
      genres: ['', 'Drama'],
      studios: [],
      countries: [],
      cast: [{ name: '' }],
      directors: [],
      writers: [],
    };
    expect(renderMovieNfo(bare)).toBe(
      HEADER +
        `<movie>
    <title>X</title>
    <id>1</id>
    <uniqueid type="tmdb" default="true">1</uniqueid>
    <genre>Drama</genre>
</movie>
`,
    );
    expect(renderEpisodeNfo(series, [{ season: 1, episode: 3 }])).not.toMatch(/<title>|aired|plot/);
  });

  it('writes no imdb id when unknown', () => {
    const withoutImdb: MovieDetails = { ...movie };
    delete (withoutImdb as { imdbId?: string }).imdbId;
    const xml = renderMovieNfo(withoutImdb);
    expect(xml).not.toContain('imdb');
    expect(xml).toContain('type="tmdb"');
  });

  it('writes actor photos only with imageUrl, and only for who has one', () => {
    expect(renderMovieNfo(movie)).not.toContain('<thumb>');
    const xml = renderMovieNfo(movie, { imageUrl: (path) => `https://img.example/w185${path}` });
    expect(xml.match(/<thumb>/g)).toHaveLength(1);
    expect(xml).toContain('<thumb>https://img.example/w185/t.jpg</thumb>');
    const parsed = parse(xml);
    expect(at(parsed, 'movie', 'actor', 0, 'thumb')).toBe('https://img.example/w185/t.jpg');
    expect(at(parsed, 'movie', 'actor', 1, 'thumb')).toBeUndefined();
  });

  it('is deterministic', () => {
    expect(renderMovieNfo(movie)).toBe(renderMovieNfo(movie));
  });
});
