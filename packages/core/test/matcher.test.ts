import { describe, expect, it } from 'vitest';
import { Matcher, type MatchOutcome, type ParsedMedia } from '../src/index.js';
import { FakeProvider, movie, season, series } from './fake-provider.js';

const parsedMovie = (
  title: string,
  year?: number,
  extra: Partial<ParsedMedia> = {},
): ParsedMedia => ({
  path: `${title}.mkv`,
  kind: 'movie',
  title,
  episodes: [],
  ...(year !== undefined && { year }),
  ...extra,
});

const parsedEpisode = (
  title: string,
  seasonNumber: number,
  episodes: number[],
  year?: number,
  extra: Partial<ParsedMedia> = {},
): ParsedMedia => ({
  path: `${title}.mkv`,
  kind: 'episode',
  title,
  season: seasonNumber,
  episodes,
  ...(year !== undefined && { year }),
  ...extra,
});

function expectMatched(outcome: MatchOutcome) {
  if (outcome.status !== 'matched') {
    throw new Error(`expected matched, got ${outcome.status}`);
  }
  return outcome;
}

function expectAmbiguous(outcome: MatchOutcome) {
  if (outcome.status !== 'ambiguous') {
    throw new Error(`expected ambiguous, got ${outcome.status}`);
  }
  return outcome;
}

describe('movies', () => {
  const dune2021 = movie(438631, 'Dune', 2021);
  const dune1984 = movie(841, 'Dune', 1984);

  it('matches on title and year, with the full score when the year disambiguates', async () => {
    const matcher = new Matcher(new FakeProvider([dune2021, dune1984]));
    const { best, others } = expectMatched(await matcher.match(parsedMovie('Dune', 2021)));
    expect(best.candidate.id.id).toBe(438631);
    expect(best.score).toBe(100);
    expect(others[0]?.candidate.id.id).toBe(841);
    expect(others[0]?.score).toBeLessThan(85);
  });

  it('is ambiguous when two same-titled movies cannot be told apart', async () => {
    const matcher = new Matcher(new FakeProvider([dune2021, dune1984]));
    const { candidates } = expectAmbiguous(await matcher.match(parsedMovie('Dune')));
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.score < 85)).toBe(true);
    expect(candidates[0]?.breakdown.margin).toBe(0);
  });

  it('matches a lone candidate even without a year', async () => {
    const matcher = new Matcher(new FakeProvider([dune2021]));
    const { best } = expectMatched(await matcher.match(parsedMovie('Dune')));
    expect(best.score).toBeGreaterThanOrEqual(85);
  });

  it('tolerates a one-year gap but not a large one', async () => {
    const matcher = new Matcher(new FakeProvider([movie(1, 'Parasite', 2019)]));
    expect(expectMatched(await matcher.match(parsedMovie('Parasite', 2020))).best.score).toBe(
      Math.round(45 + 14 + 10 + 10 + 15),
    );
    expectAmbiguous(await matcher.match(parsedMovie('Parasite', 2005)));
  });

  it('handles lowercase, punctuation-free names from guessit', async () => {
    const matcher = new Matcher(new FakeProvider([movie(693134, 'Dune: Part Two', 2024)]));
    const { best } = expectMatched(await matcher.match(parsedMovie('dune part two', 2024)));
    expect(best.breakdown.title).toBe(45);
  });

  it('uses localized and alternative titles', async () => {
    const amelie = movie(194, "Le Fabuleux Destin d'Amélie Poulain", 2001, {
      originalTitle: "Le Fabuleux Destin d'Amélie Poulain",
      alternativeTitles: ['Amelie'],
    });
    const matcher = new Matcher(new FakeProvider([amelie]));
    expectMatched(await matcher.match(parsedMovie('Amelie', 2001)));
  });

  it('matches a localized file name through the original title', async () => {
    const candidate = movie(1, 'Le Parrain', 1972, { originalTitle: 'The Godfather' });
    const matcher = new Matcher(new FakeProvider([candidate]));
    expectMatched(await matcher.match(parsedMovie('The Godfather', 1972)));
  });

  it('honours a custom threshold', async () => {
    const provider = new FakeProvider([movie(1, 'Interstellar', 2014)]);
    const parsed = parsedMovie('Interstelar', 2014);
    expectMatched(await new Matcher(provider, { threshold: 80 }).match(parsed));
    expectAmbiguous(await new Matcher(provider, { threshold: 100 }).match(parsed));
  });

  it('does not look up seasons for a movie', async () => {
    const provider = new FakeProvider([dune2021]);
    await new Matcher(provider).match(parsedMovie('Dune', 2021));
    expect(provider.calls.some((c) => c.method === 'getSeason')).toBe(false);
  });
});

describe('searching', () => {
  it('retries without the year when the first search finds nothing', async () => {
    const provider = new FakeProvider(
      [movie(1, 'Dune', 2021)],
      {},
      (query) => query.year === undefined,
    );
    const outcome = await new Matcher(provider).match(parsedMovie('Dune', 2022));
    expect(provider.calls.map((c) => c.query?.year)).toEqual([2022, undefined]);
    expect(outcome.status).not.toBe('unrecognized');
  });

  it('does not search twice when the first search has results', async () => {
    const provider = new FakeProvider([movie(1, 'Dune', 2021)]);
    await new Matcher(provider).match(parsedMovie('Dune', 2021));
    expect(provider.calls).toHaveLength(1);
  });

  it('does not repeat a yearless search', async () => {
    const provider = new FakeProvider([], {});
    const outcome = await new Matcher(provider).match(parsedMovie('Dune'));
    expect(provider.calls).toHaveLength(1);
    expect(outcome).toEqual({ status: 'unrecognized', reason: 'no-candidates' });
  });

  it('forwards the configured language', async () => {
    const provider = new FakeProvider([movie(1, 'Dune', 2021)]);
    await new Matcher(provider, { language: 'fr' }).match(parsedMovie('Dune', 2021));
    expect(provider.calls[0]?.query?.language).toBe('fr');
  });

  it('is unrecognized without a title', async () => {
    const outcome = await new Matcher(new FakeProvider([])).match({
      path: 'x.mkv',
      kind: 'unknown',
      episodes: [],
    });
    expect(outcome).toEqual({ status: 'unrecognized', reason: 'no-title' });
  });

  it('searches movies and series when the kind is unknown', async () => {
    const provider = new FakeProvider([movie(1, 'Alien', 1979), series(2, 'Alien', 1979)]);
    const outcome = await new Matcher(provider).match({
      path: 'x.avi',
      kind: 'unknown',
      title: 'Alien',
      year: 1979,
      episodes: [],
    });
    expect(provider.calls.map((c) => c.method).sort()).toEqual(['searchMovies', 'searchSeries']);
    expectAmbiguous(outcome); // Neither kind can be preferred: it needs a human.
  });

  it('searches only series for an episode and only movies for a movie', async () => {
    const provider = new FakeProvider([]);
    await new Matcher(provider).match(parsedEpisode('Show', 1, [1]));
    await new Matcher(provider).match(parsedMovie('Film'));
    expect(provider.calls.map((c) => c.method)).toEqual(['searchSeries', 'searchMovies']);
  });
});

describe('episodes', () => {
  const bear = series(136315, 'The Bear', 2022);
  const seasons = { '136315:3': season(3, [1, 2, 3, 4]) };

  it('matches when the season and episode exist', async () => {
    const matcher = new Matcher(new FakeProvider([bear], seasons));
    const { best } = expectMatched(await matcher.match(parsedEpisode('The Bear', 3, [4], 2022)));
    expect(best.breakdown.episodeExists).toBe(10);
    expect(best.score).toBe(100);
  });

  it('matches a double episode only when both episodes exist', async () => {
    const matcher = new Matcher(new FakeProvider([bear], seasons));
    expectMatched(await matcher.match(parsedEpisode('The Bear', 3, [3, 4], 2022)));
    const missing = await matcher.match(parsedEpisode('The Bear', 3, [4, 5], 2022));
    expect(expectAmbiguous(missing).candidates[0]?.breakdown.episodeExists).toBe(0);
  });

  it('loses the episode points when the season does not exist', async () => {
    const provider = new FakeProvider([bear], seasons);
    const outcome = await new Matcher(provider).match(parsedEpisode('The Bear', 9, [1], 2022));
    expect(expectAmbiguous(outcome).candidates[0]?.score).toBeLessThan(85);
  });

  it('ranks first the series that actually has the episode', async () => {
    const remake = series(2, 'Doctor Who', 2005);
    const classic = series(3, 'Doctor Who', 1963);
    const provider = new FakeProvider([classic, remake], {
      '2:1': season(1, [1, 2, 3]),
      '3:1': season(1, [1, 2]),
    });
    const matcher = new Matcher(provider);

    // Without a year the gap is modest: it ranks right but still wants a human.
    const undated = expectAmbiguous(await matcher.match(parsedEpisode('Doctor Who', 1, [3])));
    expect(undated.candidates[0]?.candidate.id.id).toBe(2);

    const dated = expectMatched(await matcher.match(parsedEpisode('Doctor Who', 1, [3], 2005)));
    expect(dated.best.candidate.id.id).toBe(2);
  });

  it('never matches automatically an episode the provider does not have', async () => {
    const provider = new FakeProvider([series(1, 'The Bear', 2022)], { '1:3': season(3, [1, 2]) });
    const outcome = expectAmbiguous(
      await new Matcher(provider).match(parsedEpisode('The Bear', 3, [9], 2022)),
    );
    // Title, year and type are perfect and the lone candidate gets the full margin (90 points),
    // yet the missing episode keeps it just under the threshold.
    expect(outcome.candidates[0]?.score).toBe(84);
  });

  it('limits season lookups to the likeliest series', async () => {
    const catalog = [
      series(1, 'The Office', 2005),
      series(2, 'The Office', 2001),
      series(3, 'The Office', 2019),
      series(4, 'The Offices of Nowhere', 2010),
      series(5, 'Totally Unrelated', 2010),
    ];
    const provider = new FakeProvider(catalog);
    await new Matcher(provider, { maxSeasonLookups: 3 }).match(parsedEpisode('The Office', 1, [1]));
    const looked = provider.calls.filter((c) => c.method === 'getSeason').map((c) => c.id?.id);
    expect(looked).toHaveLength(3);
    expect(looked).not.toContain(5);
  });

  it('also looks up the series whose id the names carry, even if unlikely', async () => {
    const catalog = [
      series(1, 'Bear', 2010),
      series(2, 'Bear', 2011),
      series(3, 'Bear', 2012),
      series(4, 'Ours', 2022),
    ];
    const provider = new FakeProvider(catalog);
    const parsed = parsedEpisode('Bear', 1, [1], undefined, {
      knownIds: [{ provider: 'tmdb', id: 4 }],
    });
    await new Matcher(provider, { maxSeasonLookups: 1 }).match(parsed);
    const looked = provider.calls.filter((c) => c.method === 'getSeason').map((c) => c.id?.id);
    expect(looked).toContain(4);
  });
});

describe('known ids', () => {
  it('does not let an id rescue a title that is too different', async () => {
    const provider = new FakeProvider([
      movie(1, 'Le Seigneur des anneaux', 2001, { originalTitle: 'The Lord of the Rings' }),
    ]);
    const parsed = parsedMovie('LOTR Fellowship', 2001, {
      knownIds: [{ provider: 'tmdb', id: 1 }],
    });
    const outcome = expectAmbiguous(await new Matcher(provider).match(parsed));
    expect(outcome.candidates[0]?.breakdown.knownId).toBe(0);
  });

  it('adds the bonus when the title is close enough', async () => {
    const catalog = [
      movie(1, 'The Lord of the Rings: The Fellowship of the Ring', 2001),
      movie(2, 'The Lord of the Rings: The Two Towers', 2002),
    ];
    const provider = new FakeProvider(catalog);
    const parsed = parsedMovie('Lord of the Rings Fellowship', 2001, {
      knownIds: [{ provider: 'tmdb', id: 1 }],
    });
    const { best } = expectMatched(await new Matcher(provider).match(parsed));
    expect(best.candidate.id.id).toBe(1);
    expect(best.breakdown.knownId).toBe(40);
  });

  it('never boosts a wrong id attached to an unrelated title', async () => {
    const provider = new FakeProvider([movie(1, 'Casablanca', 1942)]);
    const parsed = parsedMovie('Dune', 2021, { knownIds: [{ provider: 'tmdb', id: 1 }] });
    const outcome = expectAmbiguous(await new Matcher(provider).match(parsed));
    expect(outcome.candidates[0]?.breakdown.knownId).toBe(0);
  });

  it('withholds the bonus when the season or episode does not exist', async () => {
    const provider = new FakeProvider([series(1, 'The Bear', 2022)], { '1:3': season(3, [1]) });
    const parsed = parsedEpisode('The Bear', 3, [9], 2022, {
      knownIds: [{ provider: 'tmdb', id: 1 }],
    });
    const outcome = expectAmbiguous(await new Matcher(provider).match(parsed));
    expect(outcome.candidates[0]?.breakdown.knownId).toBe(0);
  });

  it('ignores ids from another provider', async () => {
    const provider = new FakeProvider([movie(1, 'Dune', 2021)]);
    const parsed = parsedMovie('Dune', 2021, { knownIds: [{ provider: 'tvdb', id: 1 }] });
    const { best } = expectMatched(await new Matcher(provider).match(parsed));
    expect(best.breakdown.knownId).toBe(0);
  });
});

describe('scores', () => {
  it('never exceeds 100 and breakdown components add up to the score', async () => {
    const provider = new FakeProvider([movie(1, 'Dune', 2021)]);
    const parsed = parsedMovie('Dune', 2021, { knownIds: [{ provider: 'tmdb', id: 1 }] });
    const { best } = expectMatched(await new Matcher(provider).match(parsed));
    const { title, year, kind, episodeExists, margin } = best.breakdown;
    expect(best.score).toBe(100);
    expect(Math.round(title + year + kind + episodeExists + margin)).toBe(100);
  });

  it('returns ambiguous candidates best first and capped', async () => {
    const catalog = Array.from({ length: 8 }, (_, i) => movie(i + 1, 'Dune', 1980 + i));
    const outcome = expectAmbiguous(
      await new Matcher(new FakeProvider(catalog)).match(parsedMovie('Dune')),
    );
    expect(outcome.candidates).toHaveLength(5);
    const scores = outcome.candidates.map((c) => c.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});
