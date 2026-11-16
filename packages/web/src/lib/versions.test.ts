import { describe, expect, it } from 'vitest';
import { languageName } from './versions.js';

describe('languageName', () => {
  it('names a track tagged with three letters, and a subtitle file given two', () => {
    expect(languageName('fre', 'en')).toBe('French');
    expect(languageName('fr', 'en')).toBe('French');
    expect(languageName('FR', 'fr')).toBe('français');
  });

  it('shows a code nobody here knows as it is', () => {
    expect(languageName('ine', 'en')).toBe('INE');
  });
});
