import { createTranslator } from '@kinoshelf/i18n';
import { describe, expect, it } from 'vitest';
import { ApiError, NETWORK_ERROR } from '../src/lib/api.js';
import { messageOf } from '../src/lib/errors.js';

const en = createTranslator('en');
const fr = createTranslator('fr');

describe('messageOf', () => {
  it('says the server cannot be reached when no answer came', () => {
    expect(messageOf(fr, new ApiError(0, NETWORK_ERROR))).toMatch(/injoignable/);
  });

  it('translates an API code with its parameters, in the language asked', () => {
    const error = new ApiError(409, 'queue.entry-resolved', { resolution: 'done' });
    expect(messageOf(en, error)).toBe('This file was already handled (done).');
    expect(messageOf(fr, error)).toBe('Ce fichier a déjà été traité (done).');
  });

  it('translates a code of the core that reaches the UI', () => {
    expect(messageOf(en, new ApiError(502, 'tmdb.invalid-key'))).toMatch(/TMDB/i);
  });

  it('shows something for a code nobody translated, and for a non-API failure', () => {
    expect(messageOf(en, new ApiError(500, 'brand.new'))).toContain('brand.new');
    expect(messageOf(en, new Error('boom'))).toMatch(/server/i);
  });
});
