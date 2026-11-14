import { createTranslator } from '@kinoshelf/i18n';
import { describe, expect, it } from 'vitest';
import {
  activeCount,
  activePills,
  ariaSortOf,
  directionToAsk,
  nextSort,
  nothingToHandle,
  pillLabel,
  sortFromQuery,
  sortToQuery,
  visibleChips,
  type ListFilters,
  type SortColumn,
} from '../src/lib/list-filters.js';
import { SERIES_FILTERS, type Counts } from '../src/lib/library-items.js';

const counts = (over: Partial<Record<keyof Counts, number>> = {}): Counts => ({
  all: 5,
  review: 0,
  rename: 0,
  unrecognized: 0,
  'missing-nfo': 0,
  'missing-artwork': 0,
  'multi-version': 0,
  'incomplete-versions': 0,
  'missing-episodes': 0,
  'missing-show-files': 0,
  ...over,
});

const none: ListFilters = { state: undefined, multi: false, collection: undefined };

describe('visibleChips', () => {
  it('shows "All" and only the states with something to handle, in the panel’s order', () => {
    const chips = visibleChips(
      SERIES_FILTERS,
      counts({ 'missing-episodes': 3, rename: 1, 'missing-show-files': 0 }),
      undefined,
    );
    expect(chips).toEqual([
      { state: undefined, count: 5 },
      { state: 'rename', count: 1 },
      { state: 'missing-episodes', count: 3 },
    ]);
  });

  it('keeps the chosen state even when it fell to none', () => {
    const chips = visibleChips(SERIES_FILTERS, counts({ rename: 2 }), 'review');
    expect(chips.map(({ state }) => state)).toEqual([undefined, 'review', 'rename']);
    expect(chips[1]?.count).toBe(0);
  });

  it('is only "All" when nothing is to be handled', () => {
    const chips = visibleChips(SERIES_FILTERS, counts(), undefined);
    expect(chips).toEqual([{ state: undefined, count: 5 }]);
    expect(nothingToHandle(chips, undefined)).toBe(true);
    expect(nothingToHandle(visibleChips(SERIES_FILTERS, counts(), 'review'), 'review')).toBe(false);
  });
});

describe('activeCount and activePills', () => {
  it('counts the state, the versions and the collection', () => {
    expect(activeCount(none)).toBe(0);
    expect(activeCount({ state: 'rename', multi: true, collection: 'tmdb:1' })).toBe(3);
    expect(activeCount({ state: undefined, multi: false, collection: 'tmdb:1' })).toBe(1);
  });

  it('gives a pill to each trait, none to the state', () => {
    expect(activePills({ ...none, state: 'rename' })).toEqual([]);
    expect(activePills({ state: 'rename', multi: true, collection: 'tmdb:1' })).toEqual([
      { id: 'multi' },
      { id: 'collection', key: 'tmdb:1' },
    ]);
  });

  it('names a pill after its trait, or after the one collection', () => {
    const t = createTranslator('fr');
    expect(pillLabel({ id: 'multi' }, t, '')).toBe('Plusieurs versions');
    expect(pillLabel({ id: 'collection', key: 'tmdb:603' }, t, 'Matrix - Saga')).toBe(
      'Collection : Matrix - Saga',
    );
  });
});

describe('the sort of a column', () => {
  const movies: readonly SortColumn[] = ['title', 'year'];
  const title = { sort: 'title', dir: 'asc' } as const;

  it('starts upwards for a title, downwards for a year or what is missing', () => {
    expect(nextSort(title, 'year')).toEqual({ sort: 'year', dir: 'desc' });
    expect(nextSort(title, 'missing')).toEqual({ sort: 'missing', dir: 'desc' });
  });

  it('turns the sorted column over on the next click, and back again', () => {
    const year = nextSort(title, 'year');
    const turned = nextSort(year, 'year');
    expect(turned).toEqual({ sort: 'year', dir: 'asc' });
    expect(nextSort(turned, 'year')).toEqual({ sort: 'year', dir: 'desc' });
    expect(nextSort(nextSort(title, 'title'), 'title')).toEqual(title);
  });

  it('is by title, ascending, by default and for a link it does not know', () => {
    expect(sortFromQuery({ sort: null, dir: null }, movies)).toEqual(title);
    expect(sortFromQuery({ sort: 'missing', dir: null }, movies)).toEqual(title);
    expect(sortFromQuery({ sort: 'year', dir: null }, movies)).toEqual({
      sort: 'year',
      dir: 'desc',
    });
    expect(sortFromQuery({ sort: 'year', dir: 'asc' }, movies)).toEqual({
      sort: 'year',
      dir: 'asc',
    });
    expect(sortFromQuery({ sort: 'year', dir: 'sideways' }, movies).dir).toBe('desc');
  });

  it('leaves what is the default out of the link and of the request', () => {
    expect(sortToQuery(title)).toEqual({ sort: undefined, dir: undefined });
    expect(sortToQuery({ sort: 'year', dir: 'desc' })).toEqual({ sort: 'year', dir: undefined });
    expect(sortToQuery({ sort: 'year', dir: 'asc' })).toEqual({ sort: 'year', dir: 'asc' });
    expect(sortToQuery({ sort: 'title', dir: 'desc' })).toEqual({ sort: undefined, dir: 'desc' });
    expect(directionToAsk({ sort: 'missing', dir: 'desc' })).toBeUndefined();
    expect(directionToAsk({ sort: 'missing', dir: 'asc' })).toBe('asc');
  });

  it('puts aria-sort on the sorted column only', () => {
    const state = { sort: 'year', dir: 'asc' } as const;
    expect(ariaSortOf(state, 'year')).toBe('ascending');
    expect(ariaSortOf({ sort: 'year', dir: 'desc' }, 'year')).toBe('descending');
    expect(ariaSortOf(state, 'title')).toBeUndefined();
  });
});
