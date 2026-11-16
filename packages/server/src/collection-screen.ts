import {
  fetchImage as defaultFetchImage,
  type CollectionImages,
  type Config,
  type ImageFetcher,
  type LibraryConfig,
} from '@kinoshelf/core';
import { ApiError } from './api-error.js';
import { listed, sniff, type Artwork, type ListedImage } from './artwork.js';
import {
  COLLECTION_IMAGE_TYPES,
  syncState,
  type CollectionImageStore,
  type ImageSource,
  type ServerState,
  type StoredImage,
  type SyncState,
} from './collection-images.js';
import { hasCollections, type CollectionEditor, type CollectionStore } from './collections.js';
import { fetchCustomImage } from './custom-image.js';
import {
  customCollectionKey,
  itemId,
  type CollectionWork,
  type LibraryItemStore,
} from './library-items.js';
import type {
  CollectionImageServer,
  CollectionImageType,
  CollectionTarget,
  MediaServerKind,
} from './notify/collection-images.js';

/** A movie of a collection: in the library, or only in TMDB's list ("Missing"). */
export interface CollectionFilm {
  readonly tmdbId: number | null;
  readonly title: string;
  readonly year: number | null;
  readonly present: boolean;
  /** The page of the movie in the library, when it is there. */
  readonly itemId: string | null;
}

/** Why a card says what it says about the image. */
export type ImageStatus = 'pending' | 'error' | 'missing' | 'sent' | 'chosen' | 'default';

export interface CollectionSummary {
  readonly key: string;
  readonly name: string;
  readonly custom: boolean;
  /** TMDB's collection id, `null` for the owner's own. */
  readonly tmdbId: number | null;
  /** Movies of it the library holds. */
  readonly held: number;
  /** Movies TMDB lists; `null` for the owner's own. */
  readonly total: number | null;
  readonly films: readonly CollectionFilm[];
  readonly images: Record<CollectionImageType, StoredImage | null>;
  /** TMDB's own poster and background, drawn while the owner has chosen none. */
  readonly tmdbImages: Record<CollectionImageType, string | null>;
  /** Only the servers that are set up. */
  readonly servers: readonly {
    readonly kind: MediaServerKind;
    readonly states: Record<CollectionImageType, ServerState>;
  }[];
  readonly status: ImageStatus;
}

export interface CollectionList {
  readonly servers: readonly MediaServerKind[];
  /** Collections with at least one image to send. */
  readonly pending: number;
  readonly collections: readonly CollectionSummary[];
}

/** One collection's send, as a line of the result. */
export interface SendOutcome {
  readonly key: string;
  readonly name: string;
  /** Images that reached a server. */
  readonly sent: number;
  /** The server has no such collection yet: it will be sent when it has. */
  readonly missing: number;
  readonly failures: readonly {
    readonly server: MediaServerKind;
    readonly type: CollectionImageType;
    readonly error: string;
  }[];
}

export interface ChoiceInput {
  readonly source: 'tmdb' | 'film' | 'url';
  /** A provider path, a movie's page id, or an address. */
  readonly value: string;
}

export interface CollectionImageListing {
  readonly tmdb: Record<CollectionImageType, readonly ListedImage[]> | null;
  readonly films: readonly {
    readonly itemId: string;
    readonly title: string;
    readonly year: number | null;
    readonly poster: boolean;
    readonly fanart: boolean;
  }[];
}

export interface CollectionScreenDeps {
  readonly config: () => Config;
  readonly items: LibraryItemStore;
  readonly store: CollectionStore;
  readonly images: CollectionImageStore;
  readonly editor: CollectionEditor;
  readonly artwork: Artwork;
  readonly servers: () => readonly CollectionImageServer[];
  readonly listImages: (tmdbId: number) => Promise<CollectionImages | null>;
  readonly imageUrl: (path: string) => string;
  /** A TMDB image at the size the screen draws it. */
  readonly previewUrl: (path: string) => string;
  readonly fetchImage?: ImageFetcher;
  readonly log: { info(message: string): void; warn(message: string): void };
}

const IMAGE_PATH = /^\/[A-Za-z0-9]{1,64}\.(jpg|png)$/;
const MIME = { jpeg: 'image/jpeg', png: 'image/png' } as const;

const tmdbIdOf = (key: string): number | null =>
  key.startsWith('tmdb:') ? Number(key.slice('tmdb:'.length)) : null;

/**
 * The Collections screen of a movie library: the collections as they stand (the owner's choices
 * taken in), the image chosen for each, and what the media servers hold. Sending is the one slow
 * part and is a task of the caller's (see `SendTasks`).
 */
export class CollectionScreen {
  constructor(private readonly deps: CollectionScreenDeps) {}

  private library(library: LibraryConfig): void {
    if (!hasCollections(library, this.deps.config())) {
      throw new ApiError(409, 'library.no-collections');
    }
  }

  list(library: LibraryConfig): CollectionList {
    this.library(library);
    const { items, store, images } = this.deps;
    const servers = this.deps.servers().map((server) => server.kind);
    const chosen = images.all(library.id);
    const traces = images.syncRows(library.id);

    const byKey = new Map<string, CollectionWork[]>();
    for (const work of items.collectionWorks(library.id)) {
      byKey.set(work.key, [...(byKey.get(work.key) ?? []), work]);
    }

    let pending = 0;
    const collections = [...byKey].map(([key, works]): CollectionSummary => {
      const first = works[0] as CollectionWork;
      const tmdbId = tmdbIdOf(key);
      const stored = tmdbId === null ? undefined : store.get(tmdbId);
      const present = new Map(works.map((work) => [work.workKey, work]));
      const listed: CollectionFilm[] =
        stored === undefined
          ? works.map((work) => this.filmOf(work))
          : [
              ...stored.parts.map((part): CollectionFilm => {
                const work = present.get(`m${String(part.id)}`);
                return work
                  ? this.filmOf(work)
                  : {
                      tmdbId: part.id,
                      title: part.title,
                      year: part.year,
                      present: false,
                      itemId: null,
                    };
              }),
              // A movie the owner filed here is no part of TMDB's list, but it is in the library.
              ...works
                .filter(
                  (work) => !stored.parts.some((part) => `m${String(part.id)}` === work.workKey),
                )
                .map((work) => this.filmOf(work)),
            ];
      // TMDB lists the parts in its own order (not the releases'): by year, ties as listed.
      const films = listed
        .map((film, index) => ({ film, index }))
        .sort((a, b) => (a.film.year ?? Infinity) - (b.film.year ?? Infinity) || a.index - b.index)
        .map(({ film }) => film);
      const choice = chosen.get(key) ?? {};
      const rows = traces.get(key) ?? [];
      const states = this.deps.servers().map((server) => ({
        kind: server.kind,
        states: Object.fromEntries(
          COLLECTION_IMAGE_TYPES.map((type) => [
            type,
            syncState(
              choice[type],
              rows.find((row) => row.server === server.kind && row.type === type),
            ),
          ]),
        ) as Record<CollectionImageType, ServerState>,
      }));
      const all = states.flatMap((entry) => Object.values(entry.states));
      const has = (state: SyncState): boolean => all.some((one) => one.state === state);
      const status: ImageStatus = has('pending')
        ? 'pending'
        : has('error')
          ? 'error'
          : has('missing')
            ? 'missing'
            : has('sent')
              ? 'sent'
              : choice.poster || choice.fanart
                ? 'chosen'
                : 'default';
      if (has('pending')) {
        pending += 1;
      }
      return {
        key,
        name: first.name,
        custom: tmdbId === null,
        tmdbId,
        held: works.length,
        total: first.total,
        films,
        images: { poster: choice.poster ?? null, fanart: choice.fanart ?? null },
        tmdbImages: {
          poster: stored?.posterPath ? this.deps.previewUrl(stored.posterPath) : null,
          fanart: stored?.backdropPath ? this.deps.previewUrl(stored.backdropPath) : null,
        },
        servers: states,
        status,
      };
    });
    return { servers, pending, collections };
  }

  private filmOf(work: CollectionWork): CollectionFilm {
    return {
      tmdbId: work.workKey.startsWith('m') ? Number(work.workKey.slice(1)) : null,
      title: work.title ?? work.leadPath,
      year: work.year,
      present: true,
      itemId: itemId(work.leadPath),
    };
  }

  private find(library: LibraryConfig, key: string): CollectionSummary {
    const found = this.list(library).collections.find((collection) => collection.key === key);
    if (!found) {
      throw new ApiError(404, 'collection.not-found');
    }
    return found;
  }

  /** What the dialog offers: TMDB's images (not for an owner's own) and the movies' own. */
  async listing(library: LibraryConfig, key: string): Promise<CollectionImageListing> {
    const collection = this.find(library, key);
    const offered =
      collection.tmdbId === null ? null : await this.deps.listImages(collection.tmdbId);
    const films = [];
    for (const film of collection.films) {
      if (film.itemId === null) {
        continue;
      }
      const [row] = this.deps.items.byItemIds(library.id, [film.itemId]);
      if (!row) {
        continue;
      }
      let poster = false;
      let fanart = false;
      try {
        const listed = await this.deps.artwork.list(this.deps.artwork.movie(library, row));
        poster = listed.current.poster !== null;
        fanart = listed.current.fanart !== null;
      } catch {
        // A movie whose images cannot be changed has none the screen could use.
      }
      films.push({ itemId: film.itemId, title: film.title, year: film.year, poster, fanart });
    }
    return {
      tmdb: offered && {
        poster: offered.poster.map(listed),
        fanart: offered.fanart.map(listed),
      },
      films,
    };
  }

  /** Downloads or reads the image and keeps it as the collection's choice. */
  async choose(
    library: LibraryConfig,
    key: string,
    type: CollectionImageType,
    choice: ChoiceInput,
  ): Promise<void> {
    const collection = this.find(library, key);
    const { image, source } = await this.fetch(library, collection, type, choice);
    await this.deps.images.choose(library.id, key, type, image, source);
  }

  private async fetch(
    library: LibraryConfig,
    collection: CollectionSummary,
    type: CollectionImageType,
    choice: ChoiceInput,
  ): Promise<{
    image: { bytes: Uint8Array; format: 'jpeg' | 'png' };
    source: ImageSource;
  }> {
    if (choice.source === 'film') {
      const film = collection.films.find((one) => one.itemId === choice.value);
      const [row] = film?.itemId ? this.deps.items.byItemIds(library.id, [film.itemId]) : [];
      if (!film || !row) {
        throw new ApiError(422, 'image.not-offered');
      }
      const { bytes, format } = await this.deps.artwork.file(
        this.deps.artwork.movie(library, row),
        type,
      );
      return {
        image: { bytes, format },
        source: { type: 'film', url: null, language: null, label: film.title },
      };
    }
    if (choice.source === 'tmdb') {
      if (collection.tmdbId === null || !IMAGE_PATH.test(choice.value)) {
        throw new ApiError(422, 'image.not-offered');
      }
      const offered = await this.deps.listImages(collection.tmdbId);
      const candidate = offered?.[type].find((image) => image.path === choice.value);
      if (!candidate) {
        throw new ApiError(422, 'image.not-offered');
      }
      const url = this.deps.imageUrl(choice.value);
      let bytes: Uint8Array;
      try {
        bytes = await (this.deps.fetchImage ?? defaultFetchImage)(url);
      } catch {
        throw new ApiError(502, 'image.unavailable');
      }
      const format = sniff(bytes);
      if (format === undefined) {
        throw new ApiError(422, 'image.url-not-image', { type: 'unknown' });
      }
      return {
        image: { bytes, format },
        source: { type: 'tmdb', url, language: candidate.language ?? null, label: null },
      };
    }
    const image = await fetchCustomImage(choice.value, {
      allowLocalNetwork: this.deps.config().allowLocalImageUrls ?? false,
    });
    return {
      image: { bytes: image.bytes, format: image.format },
      source: { type: 'url', url: choice.value, language: null, label: null },
    };
  }

  async unchoose(library: LibraryConfig, key: string, type: CollectionImageType): Promise<void> {
    this.find(library, key);
    await this.deps.images.remove(library.id, key, type);
  }

  file(library: LibraryConfig, key: string, type: CollectionImageType) {
    this.library(library);
    return this.deps.images.read(library.id, key, type);
  }

  /**
   * Renames an owner's own collection on all its movies, rewriting their NFO, and keeps the image
   * chosen. `dryRun` only counts the NFO a real run would write.
   */
  async rename(library: LibraryConfig, key: string, name: string, dryRun: boolean) {
    const collection = this.find(library, key);
    if (!collection.custom) {
      throw new ApiError(409, 'collection.not-custom');
    }
    const works = this.deps.items.collectionWorks(library.id).filter((work) => work.key === key);
    const result = await this.deps.editor.apply(
      library,
      works.map((work) => itemId(work.leadPath)),
      { mode: 'custom', name },
      { dryRun },
    );
    if (!dryRun) {
      this.deps.images.rename(library.id, key, customCollectionKey(name));
    }
    return { ...result, key: customCollectionKey(name) };
  }

  /** What a server needs to find a collection. */
  private targetOf(library: LibraryConfig, collection: CollectionSummary): CollectionTarget {
    return {
      name: collection.name,
      titles: collection.films.filter((film) => film.present).map((film) => film.title),
      libraryPath: library.source,
    };
  }

  /**
   * Sends the images that are to send (and those that failed or found no collection last time) of
   * the collections named, or of all. `onProgress` is told after each collection.
   */
  async send(
    library: LibraryConfig,
    keys: readonly string[] | undefined,
    onProgress: (done: number, total: number, current: string) => void = () => undefined,
  ): Promise<SendOutcome[]> {
    const wanted = this.list(library).collections.filter(
      (collection) =>
        (keys === undefined || keys.includes(collection.key)) &&
        collection.servers.some((server) =>
          Object.values(server.states).some((state) =>
            ['pending', 'error', 'missing'].includes(state.state),
          ),
        ),
    );
    const outcomes: SendOutcome[] = [];
    for (const collection of wanted) {
      onProgress(outcomes.length, wanted.length, collection.name);
      outcomes.push(await this.sendCollection(library, collection));
    }
    onProgress(wanted.length, wanted.length, '');
    return outcomes;
  }

  /** `only` names the `<server>:<type>` pairs to send, when not all of what is due. */
  private async sendCollection(
    library: LibraryConfig,
    collection: CollectionSummary,
    only?: ReadonlySet<string>,
  ): Promise<SendOutcome> {
    let sent = 0;
    let missing = 0;
    const failures: { server: MediaServerKind; type: CollectionImageType; error: string }[] = [];
    for (const server of this.deps.servers()) {
      const state = collection.servers.find((entry) => entry.kind === server.kind)?.states;
      const types = COLLECTION_IMAGE_TYPES.filter(
        (type) =>
          collection.images[type] !== null &&
          (only === undefined || only.has(`${server.kind}:${type}`)) &&
          state !== undefined &&
          ['pending', 'error', 'missing'].includes(state[type].state),
      );
      if (types.length === 0) {
        continue;
      }
      const target = this.targetOf(library, collection);
      for (const type of types) {
        const image = collection.images[type] as StoredImage;
        const result = await this.sendOne(library, collection, server, target, type, image);
        if (result === 'sent') {
          sent += 1;
        } else if (result === 'missing') {
          missing += 1;
        } else {
          failures.push({ server: server.kind, type, error: result.error });
        }
      }
    }
    return { key: collection.key, name: collection.name, sent, missing, failures };
  }

  private async sendOne(
    library: LibraryConfig,
    collection: CollectionSummary,
    server: CollectionImageServer,
    target: CollectionTarget,
    type: CollectionImageType,
    image: StoredImage,
  ): Promise<'sent' | 'missing' | { error: string }> {
    const { images, log } = this.deps;
    const now = new Date().toISOString();
    const fail = (message: string) => {
      images.setSync(library.id, collection.key, type, server.kind, {
        state: 'error',
        hash: null,
        at: now,
        message,
      });
      log.warn(`Collections: ${collection.name} → ${server.kind} (${type}): ${message}`);
      return { error: message };
    };

    const stored = await this.deps.images.read(library.id, collection.key, type).catch(() => null);
    if (!stored) {
      return fail('image file missing');
    }
    const payload = { bytes: stored.bytes, mime: MIME[stored.format] };

    // The id kept from last time is tried first; a 404 says the collection was deleted or made
    // again, so it is looked for once more.
    let id = images.remoteId(library.id, collection.key, server.kind);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (id === undefined) {
        const found = await server.find(target);
        if (found.status === 'missing') {
          images.setRemoteId(library.id, collection.key, server.kind, undefined);
          images.setSync(library.id, collection.key, type, server.kind, {
            state: 'missing',
            hash: null,
            at: now,
            message: null,
          });
          return 'missing';
        }
        if (found.status === 'error') {
          return fail(found.error);
        }
        id = found.id;
        images.setRemoteId(library.id, collection.key, server.kind, id);
      }
      const result = await server.upload(id, type, payload);
      if (result.ok) {
        images.setSync(library.id, collection.key, type, server.kind, {
          state: 'sent',
          hash: image.hash,
          at: now,
          message: null,
        });
        log.info(`Collections: ${collection.name} → ${server.kind} (${type}) sent`);
        return 'sent';
      }
      if (result.status !== 404 || attempt === 1) {
        return fail(result.error ?? `HTTP ${String(result.status)}`);
      }
      images.setRemoteId(library.id, collection.key, server.kind, undefined);
      id = undefined;
    }
    return fail('unreachable');
  }

  /**
   * Looks again, on each server, for the collections it did not have: one that has appeared goes
   * back to pending and is sent at once, the owner having approved the image already.
   */
  async retryMissing(library: LibraryConfig): Promise<SendOutcome[]> {
    if (!hasCollections(library, this.deps.config())) {
      return [];
    }
    const { images } = this.deps;
    const candidates = this.list(library).collections.filter((collection) =>
      collection.servers.some((server) =>
        Object.values(server.states).some((state) => state.state === 'missing'),
      ),
    );
    const outcomes: SendOutcome[] = [];
    for (const collection of candidates) {
      const target = this.targetOf(library, collection);
      const released = new Set<string>();
      for (const server of this.deps.servers()) {
        const states = collection.servers.find((entry) => entry.kind === server.kind)?.states;
        const types = COLLECTION_IMAGE_TYPES.filter((type) => states?.[type].state === 'missing');
        if (types.length === 0 || (await server.find(target)).status !== 'found') {
          continue;
        }
        images.clearMissing(library.id, collection.key, server.kind);
        for (const type of types) {
          released.add(`${server.kind}:${type}`);
        }
      }
      // Only what just left `missing` is sent: other pending images wait for their owner.
      if (released.size > 0) {
        outcomes.push(
          await this.sendCollection(library, this.find(library, collection.key), released),
        );
      }
    }
    return outcomes;
  }
}
