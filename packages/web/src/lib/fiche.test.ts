import { createTranslator } from '@kinoshelf/i18n';
import { describe, expect, it } from 'vitest';
import { ratingLines } from './fiche.js';

describe('ratingLines', () => {
  const t = createTranslator('en');

  it('lists IMDb first, then TMDB, the votes being for the tip', () => {
    expect(
      ratingLines(
        { imdb: { value: 8.04, votes: 900123 }, tmdb: { value: 7.8, votes: 1 } },
        'en',
        t,
      ),
    ).toEqual([
      { source: 'IMDb', value: '8.0', votes: 'Based on 900,123 votes' },
      { source: 'TMDB', value: '7.8', votes: 'Based on 1 vote' },
    ]);
  });

  it('writes the number the way the language does', () => {
    expect(
      ratingLines({ imdb: null, tmdb: { value: 7.8, votes: 12000 } }, 'fr', createTranslator('fr')),
    ).toMatchObject([{ value: '7,8' }]);
  });

  it('says nothing without a rating', () => {
    expect(ratingLines({ imdb: null, tmdb: null }, 'en', t)).toEqual([]);
  });
});
