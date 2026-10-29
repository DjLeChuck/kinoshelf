import { describe, expect, it } from 'vitest';
import { installmentsOf } from '../src/matching/installment.js';

describe('installmentsOf', () => {
  it.each([
    ['Kill Bill : Volume 2', [2]],
    ['Kill Bill: Vol. 1', [1]],
    ['Harry Potter and the Deathly Hallows: Part 2', [2]],
    ['The Godfather Part II', [2]],
    ['The Godfather Part III', [3]],
    ['Dune: Part Two', [2]],
    ['Mission: Impossible - Dead Reckoning Part One', [1]],
    ['Harry Potter et les Reliques de la Mort : 2ème partie', [2]],
    ['Harry Potter et les Reliques de la Mort : 1ère partie', [1]],
    ['Hunger Games : La Révolte, partie 1', [1]],
    ['Astérix Tome 3', [3]],
  ])('reads %s', (title, expected) => {
    expect(installmentsOf(title)).toEqual(expected);
  });

  it.each([
    'Dune',
    'Part of the Family',
    'Part Time Genius',
    'Parties de campagne',
    'Apartment 2',
    'Mulan 2',
    'Volume', // a marker with no number
    'The Godfather Part i', // a roman numeral in lower case is a word
  ])('finds none in %s', (title) => {
    expect(installmentsOf(title)).toEqual([]);
  });
});
