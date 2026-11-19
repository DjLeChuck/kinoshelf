import { describe, expect, it } from 'vitest';
import { languageShort } from '../src/languages.js';

describe('languageShort', () => {
  it('gives two letters for a track tag, both ISO 639-2 codes of a language included', () => {
    expect(languageShort('fre')).toBe('FR');
    expect(languageShort('fra')).toBe('FR');
    expect(languageShort('eng')).toBe('EN');
  });

  it('leaves a code nobody knows as the file gives it', () => {
    expect(languageShort('ine')).toBe('INE');
  });
});
