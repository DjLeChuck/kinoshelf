import type { Translate } from '@kinoshelf/i18n';
import { api } from './api.js';
import type { Candidate } from './images.js';
import type { LibraryItem } from './library-items.js';

/** How a movie is filed: under TMDB's collection, under none, or under a name of the owner's. */
export type CollectionMode = 'tmdb' | 'none' | 'custom';

/** What a list says of a movie's collection (`GET /api/libraries/{id}/items`). */
export interface ItemCollection {
  /** Stable in a library: `tmdb:<TMDB id>`, or `custom:<name>` for the owner's own. */
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

export const ITEM_SORTS = ['title', 'year'] as const;
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

// ---- The Collections screen of a movie library ----

export type MediaServer = 'plex' | 'jellyfin';
export type CollectionImageType = 'poster' | 'fanart';
export const COLLECTION_IMAGE_TYPES = ['poster', 'fanart'] as const;

/**
 * Where an image stands on one server: `default` (nothing chosen), `pending` (to send, or changed
 * since), `sent`, `missing` (the server has no such collection yet) or `error`.
 */
export type SyncState = 'default' | 'pending' | 'sent' | 'missing' | 'error';

/** What a card says of the image, from the worst state across the servers. */
export type ImageStatus = 'pending' | 'error' | 'missing' | 'sent' | 'chosen' | 'default';

export interface ChosenImage {
  readonly type: CollectionImageType;
  readonly format: 'jpeg' | 'png';
  readonly hash: string;
  readonly source: {
    readonly type: 'tmdb' | 'film' | 'url';
    readonly url: string | null;
    readonly language: string | null;
    readonly label: string | null;
  };
  readonly chosenAt: string;
}

export interface ServerState {
  readonly state: SyncState;
  readonly at: string | null;
  readonly message: string | null;
}

export interface CollectionFilm {
  readonly tmdbId: number | null;
  readonly title: string;
  readonly year: number | null;
  readonly present: boolean;
  readonly itemId: string | null;
}

/** A collection of the library as the screen draws it (`GET /api/libraries/{id}/collections`). */
export interface CollectionCard {
  /** `tmdb:<id>` or `custom:<normalized name>`. */
  readonly key: string;
  readonly name: string;
  readonly custom: boolean;
  readonly tmdbId: number | null;
  readonly held: number;
  readonly total: number | null;
  readonly films: readonly CollectionFilm[];
  readonly images: Readonly<Record<CollectionImageType, ChosenImage | null>>;
  /** Only the servers that are set up. */
  readonly servers: readonly {
    readonly kind: MediaServer;
    readonly states: Readonly<Record<CollectionImageType, ServerState>>;
  }[];
  readonly status: ImageStatus;
}

export interface CollectionsPage {
  readonly servers: readonly MediaServer[];
  /** Collections with an image to send. */
  readonly pending: number;
  readonly collections: readonly CollectionCard[];
}

/** The pills above the grid: all, incomplete (TMDB's only), the owner's own, image to send. */
export const COLLECTION_VIEW_FILTERS = ['all', 'incomplete', 'custom', 'pending'] as const;
export type CollectionViewFilter = (typeof COLLECTION_VIEW_FILTERS)[number];

/** A collection TMDB lists more movies for than the library holds. */
export const isIncomplete = (card: Pick<CollectionCard, 'held' | 'total'>): boolean =>
  card.total !== null && card.held < card.total;

export const matchesFilter = (card: CollectionCard, filter: CollectionViewFilter): boolean =>
  filter === 'all' ||
  (filter === 'incomplete' && isIncomplete(card)) ||
  (filter === 'custom' && card.custom) ||
  (filter === 'pending' && card.status === 'pending');

export const filterCounts = (
  cards: readonly CollectionCard[],
): Record<CollectionViewFilter, number> =>
  Object.fromEntries(
    COLLECTION_VIEW_FILTERS.map((filter) => [
      filter,
      cards.filter((card) => matchesFilter(card, filter)).length,
    ]),
  ) as Record<CollectionViewFilter, number>;

/** The completeness pill: `n/total` green or orange, or "Custom · n" for the owner's own. */
export function completenessOf(card: Pick<CollectionCard, 'held' | 'total' | 'custom'>): {
  readonly kind: 'ok' | 'warn' | 'neutral';
  readonly custom: boolean;
  readonly text: string;
} {
  if (card.custom || card.total === null) {
    return { kind: 'neutral', custom: true, text: String(card.held) };
  }
  return {
    kind: card.held >= card.total ? 'ok' : 'warn',
    custom: false,
    text: `${String(card.held)}/${String(card.total)}`,
  };
}

const SENDABLE: readonly SyncState[] = ['pending', 'error', 'missing'];

/**
 * The servers an image still has to reach: pending, failed last time, or not created there yet (a
 * send looks for the collection again, which is how one that appeared since is found without
 * waiting for the next scan).
 */
export function serversToSend(card: CollectionCard): readonly MediaServer[] {
  return card.servers
    .filter((server) =>
      COLLECTION_IMAGE_TYPES.some((type) => SENDABLE.includes(server.states[type].state)),
    )
    .map((server) => server.kind);
}

/** Whether a send would do anything for the collection: something pending, failed, or missing. */
export const canSend = (card: CollectionCard): boolean =>
  card.servers.some((server) =>
    COLLECTION_IMAGE_TYPES.some((type) => SENDABLE.includes(server.states[type].state)),
  );

/** An image that can go now: chosen and not sent yet (or changed), or whose last send failed. */
export const isDue = (card: CollectionCard): boolean =>
  card.servers.some((server) =>
    COLLECTION_IMAGE_TYPES.some((type) =>
      (['pending', 'error'] as readonly SyncState[]).includes(server.states[type].state),
    ),
  );

/** A server has no such collection yet: nothing can be sent until it creates it. */
export const isWaiting = (card: CollectionCard): boolean =>
  card.servers.some((server) =>
    COLLECTION_IMAGE_TYPES.some((type) => server.states[type].state === 'missing'),
  );

/** The one state a server shows: the worst of its poster and background. */
export function serverStatus(states: Readonly<Record<CollectionImageType, ServerState>>): {
  readonly state: SyncState;
  readonly message: string | null;
  readonly at: string | null;
} {
  const order: readonly SyncState[] = ['error', 'pending', 'missing', 'sent', 'default'];
  const worst =
    order.find((state) => COLLECTION_IMAGE_TYPES.some((type) => states[type].state === state)) ??
    'default';
  const holder = COLLECTION_IMAGE_TYPES.find((type) => states[type].state === worst);
  return {
    state: worst,
    message: holder ? states[holder].message : null,
    at: holder ? states[holder].at : null,
  };
}

export interface SendOutcome {
  readonly key: string;
  readonly name: string;
  readonly sent: number;
  readonly missing: number;
  readonly failures: readonly {
    readonly server: MediaServer;
    readonly type: CollectionImageType;
    readonly error: string;
  }[];
}

export interface SendTask {
  readonly status: 'running' | 'done' | 'failed';
  readonly done: number;
  readonly total: number;
  readonly current: string | null;
  readonly outcomes: readonly SendOutcome[];
  readonly error: {
    readonly code: string;
    readonly params?: Record<string, string | number>;
  } | null;
}

export interface SendSummary {
  /** `danger` when anything failed, `warn` when only collections are waiting for a server. */
  readonly level: 'ok' | 'warn' | 'danger';
  /** One line of totals, then one per distinct cause of failure. */
  readonly lines: readonly string[];
}

/**
 * What a send came to, kept short whatever the number of collections: the totals on one line, and
 * each cause of failure once, with how many collections it touched (the panel of a collection
 * has the detail).
 */
export function sendSummary(outcomes: readonly SendOutcome[], t: Translate): SendSummary {
  const sent = outcomes.reduce((sum, outcome) => sum + outcome.sent, 0);
  const waiting = outcomes.filter((outcome) => outcome.missing > 0).length;
  const failing = outcomes.filter((outcome) => outcome.failures.length > 0).length;
  const parts = [
    ...(sent > 0 ? [t('web.collections.send.sent', { count: sent })] : []),
    ...(waiting > 0 ? [t('web.collections.send.waiting', { count: waiting })] : []),
    ...(failing > 0 ? [t('web.collections.send.failing', { count: failing })] : []),
  ];
  const causes = new Map<string, { server: MediaServer; error: string; names: Set<string> }>();
  for (const outcome of outcomes) {
    for (const failure of outcome.failures) {
      const key = `${failure.server}|${failure.error}`;
      const known = causes.get(key) ?? {
        server: failure.server,
        error: failure.error,
        names: new Set<string>(),
      };
      known.names.add(outcome.name);
      causes.set(key, known);
    }
  }
  return {
    level: failing > 0 ? 'danger' : waiting > 0 ? 'warn' : 'ok',
    lines: [
      ...(parts.length > 0 ? [parts.join(' · ')] : []),
      ...[...causes.values()].map((cause) =>
        t('web.collections.send.cause', {
          server: cause.server === 'plex' ? 'Plex' : 'Jellyfin',
          error: cause.error,
          count: cause.names.size,
        }),
      ),
    ],
  };
}

export interface ImageListing {
  readonly tmdb: Readonly<Record<CollectionImageType, readonly Candidate[]>> | null;
  readonly films: readonly {
    readonly itemId: string;
    readonly title: string;
    readonly year: number | null;
    readonly poster: boolean;
    readonly fanart: boolean;
  }[];
}

export interface RenameResult extends CollectionResult {
  /** The collection's key under its new name. */
  readonly key: string;
}

/** A collection's API path: `ImagesDialog` reads its images and files from it. */
export const collectionBase = (libraryId: string, key: string): string =>
  `/api/libraries/${libraryId}/collections/${encodeURIComponent(key)}`;

/** Where the image chosen for a collection is served; `version` makes a browser ask again after a change. */
export const collectionImageUrl = (
  libraryId: string,
  key: string,
  type: CollectionImageType,
  version: string,
): string => `${collectionBase(libraryId, key)}/images/${type}/file?v=${version.slice(0, 12)}`;

export const collectionsApi = {
  list: (libraryId: string) => api.get<CollectionsPage>(`/api/libraries/${libraryId}/collections`),
  images: (libraryId: string, key: string) =>
    api.get<ImageListing>(`${collectionBase(libraryId, key)}/images`),
  choose: (
    libraryId: string,
    key: string,
    type: CollectionImageType,
    source: 'tmdb' | 'film' | 'url',
    value: string,
  ) => api.put(`${collectionBase(libraryId, key)}/images/${type}`, { source, value }),
  drop: (libraryId: string, key: string, type: CollectionImageType) =>
    api.delete(`${collectionBase(libraryId, key)}/images/${type}`),
  send: (libraryId: string, keys?: readonly string[]) =>
    api.post<SendTask>(`/api/libraries/${libraryId}/collections/send`, keys ? { keys } : {}),
  sendState: (libraryId: string) =>
    api.get<{ send: SendTask | null }>(`/api/libraries/${libraryId}/collections/send`),
  rename: (libraryId: string, key: string, name: string, dryRun: boolean) =>
    api.post<RenameResult>(`${collectionBase(libraryId, key)}/rename`, { name, dryRun }),
};

/** The Films | Collections choice of a movie library, read from `?vue=`. */
export type LibraryViewMode = 'films' | 'collections';
export const viewOf = (value: string | null): LibraryViewMode =>
  value === 'collections' ? 'collections' : 'films';

/** The Collections screen of a library, on one collection when a key is given. */
export const collectionsViewUrl = (libraryId: string, key?: string): string =>
  `/libraries/${libraryId}?vue=collections${key ? `&collection=${encodeURIComponent(key)}` : ''}`;
