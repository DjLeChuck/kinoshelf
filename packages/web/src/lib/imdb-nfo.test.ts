import { createTranslator } from '@kinoshelf/i18n';
import { describe, expect, it } from 'vitest';
import { imdbNfoMessage } from './imdb-nfo.js';

const t = createTranslator('en');
const none = { rewritten: 0, already: 0, noRating: 0, kept: 0, missing: 0, batchId: null };

describe('imdbNfoMessage', () => {
  it('tells what changed first', () => {
    expect(imdbNfoMessage({ ...none, rewritten: 2, kept: 1, batchId: 'b' }, t)).toBe(
      '2 NFO updated.',
    );
  });

  it('tells why nothing changed', () => {
    expect(imdbNfoMessage({ ...none, kept: 1 }, t)).toMatch(/not written by Kinoshelf/);
    expect(imdbNfoMessage({ ...none, already: 1 }, t)).toMatch(/already/);
    expect(imdbNfoMessage({ ...none, noRating: 1 }, t)).toMatch(/no rating/);
    expect(imdbNfoMessage(none, t)).toMatch(/No NFO yet/);
  });
});
