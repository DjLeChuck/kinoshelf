import { describe, expect, it } from 'vitest';
import { normalizeTitle, titleSimilarity } from '../src/index.js';

describe('normalizeTitle', () => {
  it.each([
    ['Dune: Part Two', 'dune part two'],
    ['dune.part.two', 'dune part two'],
    ["Le Fabuleux Destin d'Amélie Poulain", 'le fabuleux destin d amelie poulain'],
    ['Le Fabuleux Destin d Amelie Poulain', 'le fabuleux destin d amelie poulain'],
    ['Tom & Jerry', 'tom and jerry'],
    ['  Mr. Robot!  ', 'mr robot'],
    ['Œuvre — Été', 'œuvre ete'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected);
  });
});

describe('titleSimilarity', () => {
  it('is 1 for titles identical once normalized', () => {
    expect(titleSimilarity("Grey's Anatomy", 'grey s anatomy')).toBe(1);
    expect(titleSimilarity('Dune Part Two', 'Dune: Part Two')).toBe(1);
  });

  it('is high for a small typo and low for a different title', () => {
    expect(titleSimilarity('Interstelar', 'Interstellar')).toBeGreaterThan(0.9);
    expect(titleSimilarity('Dune', 'Dune: Part Two')).toBeLessThan(0.4);
    expect(titleSimilarity('Alien', 'Aliens')).toBeGreaterThan(0.8);
    expect(titleSimilarity('Dune', 'Casablanca')).toBeLessThan(0.2);
  });

  it('is 0 when a side is empty after normalization', () => {
    expect(titleSimilarity('???', '!!!')).toBe(0);
    expect(titleSimilarity('', 'Dune')).toBe(0);
  });
});
