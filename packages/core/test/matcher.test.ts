import { describe, expect, it } from 'vitest';
import { Matcher, StaticAliases, type MatchOutcome, type ParsedMedia } from '../src/index.js';
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

  it('matches the only same-titled series that has the season, even without a year', async () => {
    // A long-running series next to a short namesake: `Show - S10E01` fits only one of them.
    const long = series(1, 'Supernatural', 2005);
    const short = series(2, 'Supernatural', 1977);
    const provider = new FakeProvider([short, long], {
      '1:10': season(10, [1, 2, 3]),
    });
    const { best } = expectMatched(
      await new Matcher(provider).match(parsedEpisode('Supernatural', 10, [1])),
    );
    expect(best.candidate.id.id).toBe(1);
  });

  it('stays ambiguous when several same-titled series have the episode and nothing else tells them apart', async () => {
    const remake = series(2, 'Doctor Who', 2005);
    const classic = series(3, 'Doctor Who', 1963);
    const provider = new FakeProvider([classic, remake], {
      '2:1': season(1, [1, 2, 3]),
      '3:1': season(1, [1, 2, 3]),
    });
    const outcome = expectAmbiguous(
      await new Matcher(provider).match(parsedEpisode('Doctor Who', 1, [3])),
    );
    expect(outcome.candidates[0]?.breakdown.margin).toBe(0);
  });

  it('lets the year choose between same-titled series that both have the episode', async () => {
    const provider = new FakeProvider(
      [series(3, 'Doctor Who', 1963), series(2, 'Doctor Who', 2005)],
      {
        '2:1': season(1, [1, 2, 3]),
        '3:1': season(1, [1, 2, 3]),
      },
    );
    const dated = expectMatched(
      await new Matcher(provider).match(parsedEpisode('Doctor Who', 1, [3], 2005)),
    );
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

describe('series year', () => {
  // The year in a folder name may be the first release, the local one or a guess.
  const kaamelott = series(11466, 'Kaamelott', 2005);
  const seasons = { '11466:1': season(1, [1, 2, 3, 49]) };

  it.each([2005, 2004, 2003, 2020])(
    'matches a lone series when the file year is %i',
    async (year) => {
      const matcher = new Matcher(new FakeProvider([kaamelott], seasons));
      const outcome = await matcher.match(parsedEpisode('Kaamelott', 1, [49], year));
      expect(outcome.status).toBe('matched');
    },
  );

  it('still loses to the series whose year agrees', async () => {
    const remake = series(2, 'Doctor Who', 2005);
    const classic = series(3, 'Doctor Who', 1963);
    const provider = new FakeProvider([classic, remake], {
      '2:1': season(1, [1, 2, 3]),
      '3:1': season(1, [1, 2, 3]),
    });
    const { best, others } = expectMatched(
      await new Matcher(provider).match(parsedEpisode('Doctor Who', 1, [3], 2005)),
    );
    expect(best.candidate.id.id).toBe(2);
    expect(others[0]?.score).toBeLessThan(85);
  });

  it('does not let a far year rescue an episode the series does not have', async () => {
    const matcher = new Matcher(new FakeProvider([kaamelott], seasons));
    expectAmbiguous(await matcher.match(parsedEpisode('Kaamelott', 1, [99], 2020)));
  });

  it('keeps a movie strict: three years off is a different film', async () => {
    const matcher = new Matcher(new FakeProvider([movie(1, 'Parasite', 2019)]));
    expectAmbiguous(await matcher.match(parsedMovie('Parasite', 2003)));
  });

  it('gives no id bonus to a series whose year the file contradicts', async () => {
    const provider = new FakeProvider([series(1, 'Kaamelott', 2005)], { '1:1': season(1, [1]) });
    const parsed = parsedEpisode('Kaamelott', 1, [1], 1990, {
      knownIds: [{ provider: 'tmdb', id: 1 }],
    });
    const { best } = expectMatched(await new Matcher(provider).match(parsed));
    expect(best.breakdown.knownId).toBe(0);
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

  it('refuses to decide when the id and the year point to different works', async () => {
    // `Dune (2021) {tmdb-841}`: 841 is the 1984 film, the year says 2021.
    const provider = new FakeProvider([movie(438631, 'Dune', 2021), movie(841, 'Dune', 1984)]);
    const parsed = parsedMovie('Dune', 2021, { knownIds: [{ provider: 'tmdb', id: 841 }] });
    const outcome = expectAmbiguous(await new Matcher(provider).match(parsed));

    expect(outcome.candidates.every((c) => c.score < 85)).toBe(true);
    const hinted = outcome.candidates.find((c) => c.candidate.id.id === 841);
    expect(hinted?.breakdown.knownId).toBe(0); // the year contradicts it: no bonus
    expect(outcome.candidates.map((c) => c.candidate.id.id)).toContain(438631);
  });

  it('still matches when the id and the year agree', async () => {
    const provider = new FakeProvider([movie(438631, 'Dune', 2021), movie(841, 'Dune', 1984)]);
    const parsed = parsedMovie('Dune', 2021, { knownIds: [{ provider: 'tmdb', id: 438631 }] });
    expect(expectMatched(await new Matcher(provider).match(parsed)).best.score).toBe(100);
  });

  it('ignores an id that is not among the results, which it cannot verify', async () => {
    const provider = new FakeProvider([movie(438631, 'Dune', 2021)]);
    const parsed = parsedMovie('Dune', 2021, { knownIds: [{ provider: 'tmdb', id: 999999 }] });
    expectMatched(await new Matcher(provider).match(parsed));
  });

  it('ignores ids from another provider', async () => {
    const provider = new FakeProvider([movie(1, 'Dune', 2021)]);
    const parsed = parsedMovie('Dune', 2021, { knownIds: [{ provider: 'tvdb', id: 1 }] });
    const { best } = expectMatched(await new Matcher(provider).match(parsed));
    expect(best.breakdown.knownId).toBe(0);
  });
});

describe('subtitles', () => {
  const thor = movie(10195, 'Thor', 2011);
  const darkWorld = movie(76338, 'Thor : Le Monde des ténèbres', 2013);

  it('reads `Title - Subtitle` as the full TMDB title', async () => {
    const matcher = new Matcher(new FakeProvider([thor, darkWorld]));
    const named = parsedMovie('Thor', 2013, { subtitle: 'Le Monde des ténèbres' });
    const { best } = expectMatched(await matcher.match(named));
    expect(best.candidate.id.id).toBe(76338);
  });

  it('does not let a subtitle pull a movie onto an unrelated title', async () => {
    const matcher = new Matcher(new FakeProvider([thor, darkWorld]));
    const wrong = parsedMovie('Thor', 2013, { subtitle: 'Ragnarok' });
    const outcome = await matcher.match(wrong);
    if (outcome.status === 'matched') {
      expect(outcome.best.candidate.id.id).not.toBe(76338);
    }
  });
});

describe('country', () => {
  const office = (id: number, year: number, countries: string[]) =>
    ({ ...series(id, 'The Office', year), countries }) as const;
  const us = office(2316, 2005, ['US']);
  const uk = office(2996, 2001, ['GB']);
  const both = { '2316:3': season(3, [1, 2, 3, 4]), '2996:3': season(3, [1, 2, 3, 4]) };

  it('tells same-titled series apart by the country in the file name', async () => {
    const matcher = new Matcher(new FakeProvider([uk, us], both));

    const american = expectMatched(
      await matcher.match(parsedEpisode('The Office', 3, [4], undefined, { country: 'US' })),
    );
    expect(american.best.candidate.id.id).toBe(2316);
    expect(american.best.breakdown.country).toBe(10);

    const british = expectMatched(
      await matcher.match(parsedEpisode('The Office', 3, [4], undefined, { country: 'GB' })),
    );
    expect(british.best.candidate.id.id).toBe(2996);
  });

  it('stays ambiguous without a country, as it would not be able to choose', async () => {
    const matcher = new Matcher(new FakeProvider([uk, us], both));
    expectAmbiguous(await matcher.match(parsedEpisode('The Office', 3, [4])));
  });

  it('penalizes a candidate from another country', async () => {
    const matcher = new Matcher(new FakeProvider([uk, us], both));
    const outcome = expectMatched(
      await matcher.match(parsedEpisode('The Office', 3, [4], undefined, { country: 'US' })),
    );
    expect(outcome.others[0]?.breakdown.country).toBe(-15);
  });

  it('is neutral when the candidate has no known country (TMDB movies)', async () => {
    const provider = new FakeProvider([movie(1, 'Dune', 2021)]);
    const matcher = new Matcher(provider);
    const plain = expectMatched(await matcher.match(parsedMovie('Dune', 2021)));
    const withCountry = expectMatched(
      await matcher.match(parsedMovie('Dune', 2021, { country: 'US' })),
    );
    expect(withCountry.best.breakdown.country).toBe(0);
    expect(withCountry.best.score).toBe(plain.best.score);
  });

  it('does not let a country rescue an unrelated title', async () => {
    const provider = new FakeProvider([{ ...movie(1, 'Casablanca', 1942), countries: ['US'] }]);
    const outcome = expectAmbiguous(
      await new Matcher(provider).match(parsedMovie('Dune', 1942, { country: 'US' })),
    );
    expect(outcome.candidates[0]?.breakdown.country).toBe(0);
  });
});

describe('scores', () => {
  it('never exceeds 100 and breakdown components add up to the score', async () => {
    const provider = new FakeProvider([movie(1, 'Dune', 2021)]);
    const parsed = parsedMovie('Dune', 2021, { knownIds: [{ provider: 'tmdb', id: 1 }] });
    const { best } = expectMatched(await new Matcher(provider).match(parsed));
    const { title, year, kind, episodeExists, margin, country } = best.breakdown;
    expect(best.score).toBe(100);
    expect(Math.round(title + year + kind + episodeExists + margin + country)).toBe(100);
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

describe('aliases', () => {
  const us = { ...series(2, "Hell's Kitchen", 2005), countries: ['US'] };
  const uk = { ...series(3, "Hell's Kitchen", 2007), countries: ['GB'] };
  const seasons = { '2:1': season(1, [1, 2, 3]), '3:1': season(1, [1, 2, 3]) };
  const file = (title: string, seasonNumber = 1, episode = 1) =>
    parsedEpisode(title, seasonNumber, [episode]);
  const alias = (id: number) =>
    new StaticAliases([
      { kind: 'series', title: 'Gordon Ramsay Hells Kitchen', id: { provider: 'tmdb', id } },
    ]);

  it('reads a title a human tied to a work as that work, where the search would not decide', async () => {
    const provider = new FakeProvider([us, uk], seasons);
    expectAmbiguous(await new Matcher(provider).match(file('Gordon Ramsay Hells Kitchen')));

    const outcome = expectMatched(
      await new Matcher(provider, {}, alias(2)).match(file('Gordon Ramsay Hells Kitchen')),
    );
    expect(outcome.best.candidate.id.id).toBe(2);
    expect(provider.calls.some((c) => c.method === 'searchSeries')).toBe(true); // the first run
  });

  it('does not search when the alias answers', async () => {
    const provider = new FakeProvider([us, uk], seasons);
    await new Matcher(provider, {}, alias(2)).match(file('Gordon Ramsay Hells Kitchen'));
    expect(provider.calls.map((c) => c.method)).toEqual(['getSeries', 'getSeason']);
  });

  it('finds the alias whatever the casing and punctuation of the title', async () => {
    const provider = new FakeProvider([us, uk], seasons);
    expectMatched(
      await new Matcher(provider, {}, alias(2)).match(file('gordon.ramsay hells-kitchen')),
    );
  });

  it('still sends to review an episode the aliased series does not have', async () => {
    const provider = new FakeProvider([us, uk], seasons);
    expectAmbiguous(
      await new Matcher(provider, {}, alias(2)).match(file('Gordon Ramsay Hells Kitchen', 1, 9)),
    );
  });

  it('searches as usual when the provider no longer knows the work', async () => {
    const provider = new FakeProvider([us, uk], seasons);
    const outcome = await new Matcher(provider, {}, alias(999)).match(
      file('Gordon Ramsay Hells Kitchen'),
    );
    expect(outcome.status).toBe('ambiguous');
    expect(provider.calls.some((c) => c.method === 'searchSeries')).toBe(true);
  });

  it('tells same-titled films apart by year, and ignores an alias of the other kind', async () => {
    const provider = new FakeProvider([movie(841, 'Dune', 1984), movie(438631, 'Dune', 2021)]);
    const aliases = new StaticAliases([
      { kind: 'movie', title: 'Duna', year: 2021, id: { provider: 'tmdb', id: 438631 } },
    ]);
    const matcher = new Matcher(provider, {}, aliases);

    expect(expectMatched(await matcher.match(parsedMovie('Duna', 2021))).best.candidate.id.id).toBe(
      438631,
    );
    provider.calls.length = 0;
    await matcher.match(parsedMovie('Duna', 1984)); // another year: no alias
    expect(provider.calls.map((c) => c.method)).not.toContain('getMovie');
    await matcher.match(file('Duna'));
    expect(provider.calls.map((c) => c.method)).not.toContain('getSeries');
  });

  it('leaves a file that carries ids to the id logic', async () => {
    const provider = new FakeProvider([us, uk], seasons);
    await new Matcher(provider, {}, alias(2)).match({
      ...file('Gordon Ramsay Hells Kitchen'),
      knownIds: [{ provider: 'tmdb', id: 3 }],
    });
    expect(provider.calls.map((c) => c.method)).not.toContain('getSeries');
  });
});

describe('volumes', () => {
  const vol1 = movie(24, 'Kill Bill : Volume 1', 2003);
  const vol2 = movie(393, 'Kill Bill : Volume 2', 2004);

  it('tells the volumes apart when the rest of the title is the same', async () => {
    const matcher = new Matcher(new FakeProvider([vol1, vol2]));
    const two = expectMatched(await matcher.match(parsedMovie('Kill Bill', 2004, { volume: 2 })));
    expect(two.best.candidate.id.id).toBe(393);
    expect(two.best.breakdown.volume).toBe(10);
    expect(two.others[0]?.breakdown.volume).toBe(-15);
    const one = expectMatched(await matcher.match(parsedMovie('Kill Bill', 2003, { volume: 1 })));
    expect(one.best.candidate.id.id).toBe(24);
  });

  it('does not let the volume overrule the year: a year of the other volume stays in review', async () => {
    const matcher = new Matcher(new FakeProvider([vol1, vol2]));
    // Vol.2 with the year of Vol.1: neither the number nor the year can be trusted over the other.
    expectAmbiguous(await matcher.match(parsedMovie('Kill Bill', 2003, { volume: 2 })));
  });

  it('sends a volume that does not exist to review', async () => {
    const matcher = new Matcher(new FakeProvider([vol1, vol2]));
    expectAmbiguous(await matcher.match(parsedMovie('Kill Bill', 2004, { volume: 3 })));
  });

  it('is neutral when the candidate names no volume, or the file names none', async () => {
    const plain = expectMatched(
      await new Matcher(new FakeProvider([movie(1, 'Dune', 2021)])).match(
        parsedMovie('Dune', 2021, { volume: 2 }),
      ),
    );
    expect(plain.best.breakdown.volume).toBe(0);
    const unnumbered = await new Matcher(new FakeProvider([vol1, vol2])).match(
      parsedMovie('Kill Bill', 2004),
    );
    expect(unnumbered.status === 'matched' ? unnumbered.best.breakdown.volume : 0).toBe(0);
  });
});

describe('parts', () => {
  const hallows = (id: number, title: string, year: number) => movie(id, title, year);
  const part1 = hallows(12444, 'Harry Potter and the Deathly Hallows: Part 1', 2010);
  const part2 = hallows(12445, 'Harry Potter and the Deathly Hallows: Part 2', 2011);
  const file = (number: number, year?: number) =>
    parsedMovie('Harry Potter And The Deathly Hallows', year, { volume: number });

  it('picks the part when the file has no year to tell them apart', async () => {
    const matcher = new Matcher(new FakeProvider([part1, part2]));
    expect(expectMatched(await matcher.match(file(2))).best.candidate.id.id).toBe(12445);
    expect(expectMatched(await matcher.match(file(1))).best.candidate.id.id).toBe(12444);
  });

  it('reads the French way of writing it, and a part spelled out', async () => {
    const french = [
      movie(12444, 'Harry Potter et les Reliques de la Mort : 1ère partie', 2010),
      movie(12445, 'Harry Potter et les Reliques de la Mort : 2ème partie', 2011),
    ];
    const outcome = expectMatched(
      await new Matcher(new FakeProvider(french)).match(
        parsedMovie('Harry Potter et les Reliques de la Mort', undefined, { volume: 2 }),
      ),
    );
    expect(outcome.best.candidate.id.id).toBe(12445);

    const roman = [
      movie(1, 'The Godfather Part II', 1974),
      movie(2, 'The Godfather Part III', 1990),
    ];
    expect(
      expectMatched(
        await new Matcher(new FakeProvider(roman)).match(
          parsedMovie('The Godfather', 1990, { volume: 3 }),
        ),
      ).best.candidate.id.id,
    ).toBe(2);
  });

  it('sends a part that does not exist to review', async () => {
    const matcher = new Matcher(new FakeProvider([part1, part2]));
    expectAmbiguous(await matcher.match(file(3)));
  });

  it('leaves to a human a part whose number and year name different films', async () => {
    const matcher = new Matcher(new FakeProvider([part1, part2]));
    // `Part.2` with the year of Part 1: the year is tolerated one off, which alone would let
    // Part 2 win at 97.
    expectAmbiguous(await matcher.match(file(2, 2010)));
    expectAmbiguous(await matcher.match(file(1, 2011)));
  });

  it('still takes the part when the year agrees or is one off with no rival on that year', async () => {
    const matcher = new Matcher(new FakeProvider([part1, part2]));
    expect(expectMatched(await matcher.match(file(2, 2011))).best.candidate.id.id).toBe(12445);
    expect(expectMatched(await matcher.match(file(2, 2012))).best.candidate.id.id).toBe(12445);
  });
});

describe('bilingual titles', () => {
  const anatomie = {
    ...movie(915935, "Anatomie d'une chute", 2023),
    originalTitle: 'Anatomie d’une chute',
  };
  const bilingual = (year: number) =>
    parsedMovie('Anatomy Of A Fall-Anatomie d une chute', year, {
      otherTitles: ['Anatomy Of A Fall', 'Anatomie d une chute'],
    });

  it('matches through the language the provider knows the work in', async () => {
    const matcher = new Matcher(new FakeProvider([anatomie]));
    expectAmbiguous(
      await matcher.match(parsedMovie('Anatomy Of A Fall-Anatomie d une chute', 2023)),
    );
    expect(expectMatched(await matcher.match(bilingual(2023))).best.candidate.id.id).toBe(915935);
  });

  it('does not let a half rescue a wrong year', async () => {
    const matcher = new Matcher(new FakeProvider([anatomie]));
    expectAmbiguous(await matcher.match(bilingual(2019)));
  });

  it('does not let a half pull a file onto an unrelated work', async () => {
    const impossible = movie(954, 'Mission: Impossible', 1996);
    const matcher = new Matcher(new FakeProvider([impossible]));
    const file = parsedMovie('Mission Impossible-Dead Reckoning', 2023, {
      otherTitles: ['Mission Impossible', 'Dead Reckoning'],
    });
    expectAmbiguous(await matcher.match(file));
  });
});
