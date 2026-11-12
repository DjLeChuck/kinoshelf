import type { Translate } from '@kinoshelf/i18n';
import { api } from './api.js';
import type { LibraryItem } from './library-items.js';

/** How a movie is filed: under TMDB's collection, under none, or under a name of the owner's. */
export type CollectionMode = 'tmdb' | 'none' | 'custom';

/** What a list says of a movie's collection (`GET /api/libraries/{id}/items`). */
export interface ItemCollection {
  /** Stable in a library: `t:<TMDB id>`, or `c:<name>` for the owner's own. */
  readonly key: string;
  readonly name: string;
  readonly custom: boolean;
  /** Movies of it that the library holds, and the ones TMDB lists (`null`: nothing to count). */
  readonly held: number;
  readonly total: number | null;
}

/** The collection section of a movie's page. */
export interface CollectionDetail {
  /** TMDB's collection for the movie, whatever the owner decided. */
  readonly tmdb: { readonly id: number; readonly name: string } | null;
  readonly choice: CollectionMode;
  /** The owner's name when `choice` is `custom`. */
  readonly name: string | null;
  readonly effective: ItemCollection | null;
  readonly parts: readonly {
    readonly id: number;
    readonly title: string;
    readonly year: number | null;
    readonly present: boolean;
  }[];
  readonly customNames: readonly string[];
}

/** What the owner is picking: not yet applied. */
export interface CollectionDraft {
  readonly mode: CollectionMode;
  readonly name: string;
}

/** What changing a collection did: NFO counted as they were handled. */
export interface CollectionResult {
  readonly movies: number;
  readonly rewritten: number;
  readonly unchanged: number;
  /** Edited since Kinoshelf wrote them: left as they are. */
  readonly kept: number;
  readonly missing: number;
  readonly batchId: string | null;
}

export const COLLECTION_FILTERS = ['in', 'out', 'incomplete'] as const;
/** `in`, `out`, `incomplete`, or the key of one collection. */
export type CollectionFilter = string;
export const ITEM_SORTS = ['title', 'collection', 'year'] as const;
export type ItemSort = (typeof ITEM_SORTS)[number];

/** A movie the library has identified: only those are filed under a collection. */
export const canFile = (item: Pick<LibraryItem, 'kind' | 'tmdbId' | 'state'>): boolean =>
  item.kind === 'movie' &&
  item.tmdbId !== null &&
  item.state !== 'review' &&
  item.state !== 'unrecognized';

/** The pastille of a collection in a list: how much of it is held, or that it is the owner's own. */
export function pillOf(collection: ItemCollection): {
  readonly kind: 'ok' | 'warn' | 'neutral';
  readonly text: string | null;
} {
  if (collection.custom || collection.total === null) {
    return { kind: 'neutral', text: null };
  }
  return {
    kind: collection.held >= collection.total ? 'ok' : 'warn',
    text: `${collection.held}/${collection.total}`,
  };
}

/** Whether a row opens a new group: the list is ordered by collection and this one is not the last's. */
export function startsGroup(
  items: readonly Pick<{ collection: ItemCollection | null }, 'collection'>[],
  index: number,
  sort: ItemSort,
): boolean {
  if (sort !== 'collection' || index === 0) {
    return false;
  }
  return (items[index]?.collection?.key ?? null) !== (items[index - 1]?.collection?.key ?? null);
}

/** The name of the collection a filter by key shows: the one of any row that has it. */
export function nameOfKey(
  key: string,
  items: readonly { readonly collection: ItemCollection | null }[],
): string {
  return items.find((item) => item.collection?.key === key)?.collection?.name ?? key.slice(2);
}

export const draftOf = (detail: Pick<CollectionDetail, 'choice' | 'name'>): CollectionDraft => ({
  mode: detail.choice,
  name: detail.choice === 'custom' ? (detail.name ?? '') : '',
});

/** A custom collection needs a name; the other two choices need nothing. */
export const isValid = (draft: CollectionDraft): boolean =>
  draft.mode !== 'custom' || draft.name.trim() !== '';

/** Whether applying the draft would change anything. */
export function isChanged(draft: CollectionDraft, current: CollectionDraft): boolean {
  return (
    draft.mode !== current.mode ||
    (draft.mode === 'custom' && draft.name.trim() !== current.name.trim())
  );
}

/**
 * Whether the dialog's Apply is live. For one movie `current` is where it stands and the choice
 * must differ from it; for a selection there is no current (`undefined`) and nothing is chosen
 * until the owner picks, so any valid pick applies. `draft` is `undefined` until they pick.
 */
export function canApply(
  draft: CollectionDraft | undefined,
  current: CollectionDraft | undefined,
): boolean {
  if (draft === undefined || !isValid(draft)) {
    return false;
  }
  return current === undefined || isChanged(draft, current);
}

/** NFO a selection concerns: one per version of each movie (`movie.nfo` is shared, `<file>.nfo` is not). */
export const nfoCount = (items: readonly { readonly versions: readonly unknown[] }[]): number =>
  items.reduce((sum, item) => sum + Math.max(item.versions.length, 1), 0);

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

const escapeXml = (text: string): string =>
  text.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char);

/**
 * The tag the NFO will carry, as the writer makes it (the long form, the only one Plex's agent
 * reads); `null` when the movie is filed under none.
 */
export function setPreview(draft: CollectionDraft, tmdb: CollectionDetail['tmdb']): string | null {
  if (draft.mode === 'none') {
    return null;
  }
  if (draft.mode === 'tmdb') {
    return tmdb ? `<set tmdbcolid="${tmdb.id}"><name>${escapeXml(tmdb.name)}</name></set>` : null;
  }
  return `<set><name>${escapeXml(draft.name.trim() || '…')}</name></set>`;
}

export const collectionApi = {
  /** Files the movies (the `id`s of the list) under the choice, and writes their NFO again. */
  set: (libraryId: string, items: readonly string[], draft: CollectionDraft) =>
    api.put<CollectionResult>(`/api/libraries/${libraryId}/collection`, {
      items,
      choice: draft.mode,
      ...(draft.mode === 'custom' && { name: draft.name.trim() }),
    }),
};

/** What changing a collection did, for the notice under the bar or the panel. */
export function resultNotice(result: CollectionResult, t: Translate): string {
  return [
    t('web.collection.done', { rewritten: result.rewritten }),
    ...(result.kept > 0 ? [t('web.collection.kept', { kept: result.kept })] : []),
    ...(result.missing > 0 ? [t('web.collection.missing', { missing: result.missing })] : []),
  ].join(' · ');
}
