import { describe, expect, it } from 'vitest';
import { effectiveCollection, withCollection } from '../src/index.js';
import type { MovieCollection, MovieDetails } from '../src/index.js';

const tmdb: MovieCollection = {
  id: { provider: 'tmdb', id: 645 },
  name: 'James Bond Collection',
  overview: 'Bond.',
};

const details: MovieDetails = {
  kind: 'movie',
  id: { provider: 'tmdb', id: 1 },
  title: 'Dr. No',
  originalTitle: 'Dr. No',
  genres: [],
  tags: [],
  studios: [],
  countries: [],
  cast: [],
  directors: [],
  writers: [],
  collection: tmdb,
};

describe('effectiveCollection', () => {
  it("is the provider's collection when the owner decided nothing", () => {
    expect(effectiveCollection(tmdb)).toBe(tmdb);
    expect(effectiveCollection(undefined)).toBeUndefined();
  });

  it('is none when the owner removed it, even if the provider names one', () => {
    expect(effectiveCollection(tmdb, { mode: 'none' })).toBeUndefined();
  });

  it("is the owner's own, with no provider id, over the provider's", () => {
    expect(effectiveCollection(tmdb, { mode: 'custom', name: '  Univers Marvel ' })).toEqual({
      name: 'Univers Marvel',
    });
    expect(effectiveCollection(undefined, { mode: 'custom', name: 'Univers Marvel' })).toEqual({
      name: 'Univers Marvel',
    });
  });

  it('ignores a custom override with no name rather than writing an empty one', () => {
    expect(effectiveCollection(tmdb, { mode: 'custom', name: '   ' })).toBe(tmdb);
  });
});

describe('withCollection', () => {
  it('replaces or drops the collection without touching the rest', () => {
    expect(withCollection(details).collection).toBe(tmdb);
    expect(withCollection(details, { mode: 'custom', name: 'Spies' }).collection).toEqual({
      name: 'Spies',
    });
    const none = withCollection(details, { mode: 'none' });
    expect(none).not.toHaveProperty('collection');
    expect(none.title).toBe('Dr. No');
  });
});
