import { describe, expect, it } from 'vitest';
import {
  canApply,
  canFile,
  draftOf,
  isChanged,
  isValid,
  nameOfKey,
  nfoCount,
  pillOf,
  setPreview,
  type ItemCollection,
} from '../src/lib/collections.js';
import { itemsUrl } from '../src/lib/library-items.js';

const coll = (over: Partial<ItemCollection> = {}): ItemCollection => ({
  key: 't:1',
  name: 'Dragons - Saga',
  custom: false,
  held: 2,
  total: 3,
  ...over,
});

describe('pillOf', () => {
  it('is green when the library holds the whole collection, orange when it holds part', () => {
    expect(pillOf(coll({ held: 2, total: 2 }))).toEqual({ kind: 'ok', text: '2/2' });
    expect(pillOf(coll({ held: 1, total: 3 }))).toEqual({ kind: 'warn', text: '1/3' });
  });

  it('is neutral, with no count, for the owner’s own collection or one TMDB lists nothing for', () => {
    expect(pillOf(coll({ custom: true, total: null }))).toEqual({ kind: 'neutral', text: null });
    expect(pillOf(coll({ total: null }))).toEqual({ kind: 'neutral', text: null });
  });
});

describe('canFile', () => {
  it('is a movie the library identified, not one that waits for a person', () => {
    expect(canFile({ kind: 'movie', tmdbId: 1, state: 'ok' })).toBe(true);
    expect(canFile({ kind: 'movie', tmdbId: 1, state: 'rename' })).toBe(true);
    expect(canFile({ kind: 'movie', tmdbId: 1, state: 'review' })).toBe(false);
    expect(canFile({ kind: 'movie', tmdbId: null, state: 'ok' })).toBe(false);
    expect(canFile({ kind: 'series', tmdbId: 1, state: 'ok' })).toBe(false);
  });
});

describe('nameOfKey', () => {
  it('reads the name from a row that has the collection, else from the key', () => {
    expect(nameOfKey('t:1', [{ collection: coll() }])).toBe('Dragons - Saga');
    expect(nameOfKey('c:Univers Marvel', [])).toBe('Univers Marvel');
  });
});

describe('the draft', () => {
  const current = { mode: 'tmdb', name: '' } as const;

  it('starts from the choice in force', () => {
    expect(draftOf({ choice: 'custom', name: 'Marvel' })).toEqual({
      mode: 'custom',
      name: 'Marvel',
    });
    expect(draftOf({ choice: 'none', name: 'ignored' })).toEqual({ mode: 'none', name: '' });
  });

  it('can be applied only when it changes something and is valid', () => {
    expect(isChanged(current, current)).toBe(false);
    expect(isChanged({ mode: 'none', name: '' }, current)).toBe(true);
    expect(
      isChanged({ mode: 'custom', name: ' Marvel ' }, { mode: 'custom', name: 'Marvel' }),
    ).toBe(false);
    expect(isChanged({ mode: 'custom', name: 'DC' }, { mode: 'custom', name: 'Marvel' })).toBe(
      true,
    );
    expect(isValid({ mode: 'custom', name: '  ' })).toBe(false);
    expect(isValid({ mode: 'custom', name: 'DC' })).toBe(true);
    expect(isValid({ mode: 'none', name: '' })).toBe(true);
  });
});

describe('setPreview', () => {
  const tmdb = { id: 645, name: 'James Bond Collection' };

  it('shows the tag the NFO will carry, in the long form', () => {
    expect(setPreview({ mode: 'tmdb', name: '' }, tmdb)).toBe(
      '<set tmdbcolid="645"><name>James Bond Collection</name></set>',
    );
    expect(setPreview({ mode: 'custom', name: ' Univers Marvel ' }, tmdb)).toBe(
      '<set><name>Univers Marvel</name></set>',
    );
  });

  it('shows no tag for none, or for TMDB’s collection when there is none', () => {
    expect(setPreview({ mode: 'none', name: '' }, tmdb)).toBeNull();
    expect(setPreview({ mode: 'tmdb', name: '' }, null)).toBeNull();
  });

  it('escapes what XML would, and holds a place for a name not typed yet', () => {
    expect(setPreview({ mode: 'custom', name: 'Tom & <Jerry>' }, null)).toBe(
      '<set><name>Tom &amp; &lt;Jerry&gt;</name></set>',
    );
    expect(setPreview({ mode: 'custom', name: ' ' }, null)).toBe('<set><name>…</name></set>');
  });
});

describe('itemsUrl with collections', () => {
  it('asks for a collection filter and a sort, the default sort being implied', () => {
    expect(itemsUrl('films', { collection: 'incomplete', sort: 'collection', limit: 50 })).toBe(
      '/api/libraries/films/items?collection=incomplete&sort=collection&limit=50',
    );
    expect(itemsUrl('films', { collection: 'c:Univers Marvel', sort: 'title', limit: 50 })).toBe(
      '/api/libraries/films/items?collection=c%3AUnivers%20Marvel&limit=50',
    );
  });
});

describe('canApply (the dialog’s Apply)', () => {
  const tmdb = { mode: 'tmdb', name: '' } as const;
  const none = { mode: 'none', name: '' } as const;
  const custom = (name: string) => ({ mode: 'custom', name }) as const;

  describe('for one movie, where the choice must differ from where it stands', () => {
    it('is off until the owner changes the choice', () => {
      expect(canApply(tmdb, tmdb)).toBe(false);
      expect(canApply(custom('Saga'), custom('Saga'))).toBe(false);
      expect(canApply(custom(' Saga '), custom('Saga'))).toBe(false);
    });

    it('is on for another mode, or another custom name', () => {
      expect(canApply(none, tmdb)).toBe(true);
      expect(canApply(custom('Saga 2'), custom('Saga'))).toBe(true);
    });

    it('stays off for a custom collection with no name, even though it changes', () => {
      expect(canApply(custom('  '), tmdb)).toBe(false);
      expect(canApply(custom(''), none)).toBe(false);
    });
  });

  describe('for a selection, where nothing is chosen beforehand', () => {
    it('is off until a choice is made', () => {
      expect(canApply(undefined, undefined)).toBe(false);
    });

    it('is on for any valid choice, TMDB’s and none included', () => {
      expect(canApply(tmdb, undefined)).toBe(true);
      expect(canApply(none, undefined)).toBe(true);
      expect(canApply(custom('Saga'), undefined)).toBe(true);
    });

    it('stays off for a custom collection with no name', () => {
      expect(canApply(custom(' '), undefined)).toBe(false);
    });
  });
});

describe('nfoCount', () => {
  it('counts one NFO per version, so a movie held twice counts twice', () => {
    expect(nfoCount([{ versions: [1, 2] }, { versions: [1] }, { versions: [1, 2, 3] }])).toBe(6);
  });

  it('counts a movie with no version listed once', () => {
    expect(nfoCount([{ versions: [] }])).toBe(1);
  });
});
