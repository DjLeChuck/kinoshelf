import { describe, expect, it } from 'vitest';
import {
  baseLanguage,
  isImageAddress,
  languagesOf,
  sortCandidates,
  type Candidate,
} from '../src/lib/images.js';

const image = (
  path: string,
  language: string | null,
  votes: number,
  rating: number | null = null,
): Candidate => ({ path, language, width: 1000, height: 1500, rating, votes });

describe('sortCandidates', () => {
  it('puts the library’s language first, then no text, then the rest, by votes', () => {
    const sorted = sortCandidates(
      [
        image('/en-many', 'en', 50),
        image('/none', null, 9),
        image('/fr-few', 'fr', 1),
        image('/fr-many', 'fr', 7),
        image('/de', 'de', 3),
      ],
      'fr',
    );
    expect(sorted.map(({ path }) => path)).toEqual([
      '/fr-many',
      '/fr-few',
      '/none',
      '/en-many',
      '/de',
    ]);
  });

  it('breaks a tie of votes by rating, then keeps the provider’s order', () => {
    const sorted = sortCandidates(
      [image('/a', 'fr', 2, 5), image('/b', 'fr', 2, 6), image('/c', 'fr', 2, 6)],
      'fr',
    );
    expect(sorted.map(({ path }) => path)).toEqual(['/b', '/c', '/a']);
  });
});

describe('languagesOf', () => {
  it('lists each language once, in the order given, no text included', () => {
    expect(languagesOf([image('/1', 'fr', 1), image('/2', null, 1), image('/3', 'fr', 1)])).toEqual(
      ['fr', null],
    );
  });
});

describe('baseLanguage', () => {
  it.each([
    ['fr-FR', 'fr'],
    ['EN', 'en'],
    [null, ''],
  ])('reads %s as %s', (value, expected) => {
    expect(baseLanguage(value)).toBe(expected);
  });
});

describe('isImageAddress', () => {
  it.each([
    ['https://example.org/a.jpg', true],
    [' http://192.168.1.2/a.png ', true],
    ['ftp://example.org/a.jpg', false],
    ['example.org/a.jpg', false],
    ['', false],
  ])('%s: %s', (value, expected) => {
    expect(isImageAddress(value)).toBe(expected);
  });
});
