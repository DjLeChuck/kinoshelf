import { describe, expect, it } from 'vitest';
import { countryOf, movieRating, pickCertification } from '../src/certification.js';

describe('countryOf', () => {
  it.each([
    ['fr', 'FR'],
    ['en', 'US'],
    ['ja', 'JP'],
    ['en-GB', 'GB'],
    ['pt-br', 'BR'],
    ['de', 'DE'],
    [undefined, 'US'],
  ])('%s gives %s', (language, country) => {
    expect(countryOf(language)).toBe(country);
  });
});

describe('pickCertification', () => {
  const ratings = [
    { country: 'US', value: 'PG-13' },
    { country: 'FR', value: '12' },
    { country: 'DE', value: '' },
    { country: 'GB', value: '15' },
  ];

  it("takes the language's country", () => {
    expect(pickCertification(ratings, 'fr')).toEqual({ country: 'FR', value: '12' });
    expect(pickCertification(ratings, 'en-GB')).toEqual({ country: 'GB', value: '15' });
  });

  it('falls back to the United States, then to the first rating there is', () => {
    expect(pickCertification(ratings, 'de')).toEqual({ country: 'US', value: 'PG-13' });
    expect(pickCertification([{ country: 'GB', value: '15' }], 'fr')).toEqual({
      country: 'GB',
      value: '15',
    });
  });

  it('says nothing when no country has a rating', () => {
    expect(pickCertification([{ country: 'FR', value: ' ' }], 'fr')).toBeUndefined();
    expect(pickCertification([], 'fr')).toBeUndefined();
  });
});

describe('movieRating', () => {
  it('prefers the theatrical release, else the first rated one', () => {
    expect(
      movieRating([
        { certification: '18', type: 5 },
        { certification: '12', type: 3 },
      ]),
    ).toBe('12');
    expect(
      movieRating([
        { certification: '', type: 3 },
        { certification: '16', type: 4 },
      ]),
    ).toBe('16');
    expect(movieRating([{ certification: '', type: 3 }])).toBeUndefined();
  });
});
