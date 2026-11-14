import type { Translate } from '@kinoshelf/i18n';
import type { Counts, ShowFilter } from './library-items.js';
import { oneOf } from './routes.js';

// What the two rows above a list say: the states to handle, the traits a list is narrowed by, and
// the order of its columns. Pure, so the rules (which chip shows, what the badge counts, which way
// a first click sorts) are tested apart from the page that draws them.

export type SortDirection = 'asc' | 'desc';
/** Movies sort by title or year; shows by title, year or what they lack. */
export type SortColumn = 'title' | 'year' | 'missing';

export interface SortState {
  readonly sort: SortColumn;
  readonly dir: SortDirection;
}

/** A column's first click: a name reads upwards, a year or a count shows the most first. */
export const FIRST_DIRECTION: Readonly<Record<SortColumn, SortDirection>> = {
  title: 'asc',
  year: 'desc',
  missing: 'desc',
};

const DIRECTIONS: readonly SortDirection[] = ['asc', 'desc'];

/** The sort a link asks for (`?sort=year&dir=asc`): a stale value falls back to title, ascending. */
export function sortFromQuery(
  params: { readonly sort: string | null; readonly dir: string | null },
  allowed: readonly SortColumn[],
): SortState {
  const sort = oneOf(params.sort, allowed) ?? 'title';
  return { sort, dir: oneOf(params.dir, DIRECTIONS) ?? FIRST_DIRECTION[sort] };
}

/** What a click on a column's header leads to: the other way on the sorted column, else its own first way. */
export function nextSort(current: SortState, column: SortColumn): SortState {
  if (current.sort === column) {
    return { sort: column, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { sort: column, dir: FIRST_DIRECTION[column] };
}

/** The sort as URL parameters: what is the default is left out, so a link stays short. */
export function sortToQuery(state: SortState): {
  readonly sort: string | undefined;
  readonly dir: string | undefined;
} {
  return {
    sort: state.sort === 'title' ? undefined : state.sort,
    dir: state.dir === FIRST_DIRECTION[state.sort] ? undefined : state.dir,
  };
}

/** The `aria-sort` of a column header: set on the sorted column only. */
export function ariaSortOf(
  current: SortState,
  column: SortColumn,
): 'ascending' | 'descending' | undefined {
  if (current.sort !== column) {
    return undefined;
  }
  return current.dir === 'asc' ? 'ascending' : 'descending';
}

/** What the API is asked: the direction only when it is not the sort's own first one. */
export const directionToAsk = (state: SortState): SortDirection | undefined =>
  state.dir === FIRST_DIRECTION[state.sort] ? undefined : state.dir;

export interface Chip {
  /** `undefined` is "All". */
  readonly state: ShowFilter | undefined;
  readonly count: number;
}

/**
 * The state chips under the toolbar: "All", then only the states with something to handle, and
 * the chosen one even when it has dropped to none (it would vanish under the person's finger).
 */
export function visibleChips(
  states: readonly ShowFilter[],
  counts: Counts,
  active: ShowFilter | undefined,
): readonly Chip[] {
  return [
    { state: undefined, count: counts.all },
    ...states
      .filter((state) => counts[state] > 0 || state === active)
      .map((state) => ({ state, count: counts[state] })),
  ];
}

/** Nothing waits for a person: "All" is the only chip. */
export const nothingToHandle = (chips: readonly Chip[], active: ShowFilter | undefined): boolean =>
  chips.length === 1 && active === undefined;

export interface ListFilters {
  readonly state: ShowFilter | undefined;
  readonly multi: boolean;
  /** The key of the one collection the list is narrowed to (`tmdb:<id>`, `custom:<name>`). */
  readonly collection: string | undefined;
}

/** What the Filters button's badge counts: the state, the versions, the collection. */
export const activeCount = (filters: ListFilters): number =>
  (filters.state === undefined ? 0 : 1) +
  (filters.multi ? 1 : 0) +
  (filters.collection === undefined ? 0 : 1);

export type Pill = { readonly id: 'multi' } | { readonly id: 'collection'; readonly key: string };

/**
 * The removable pills: one per trait. The state has none, its chip is already pressed.
 */
export function activePills(filters: ListFilters): readonly Pill[] {
  return [
    ...(filters.multi ? [{ id: 'multi' } as const] : []),
    ...(filters.collection === undefined
      ? []
      : [{ id: 'collection', key: filters.collection } as const]),
  ];
}

export function pillLabel(pill: Pill, t: Translate, collectionName: string): string {
  return pill.id === 'multi'
    ? t('web.library.filter.multi-version')
    : t('web.collection.filter.active', { name: collectionName });
}
