import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, resolve } from 'node:path';
import {
  buildProfile,
  expectedNfoPaths,
  libraryProfile,
  renderMovieNfo,
  rewriteNfo,
  withCollection,
  type CollectionInfo,
  type CollectionOverride,
  type Config,
  type Database,
  type ImageSize,
  type Journal,
  type LibraryConfig,
  type MovieDetails,
} from '@kinoshelf/core';
import { ApiError } from './api-error.js';
import { isUnsettled, type LibraryItemStore } from './library-items.js';

/** A collection and the movies it lists, as the provider named them at the last read. */
export interface StoredCollection {
  readonly id: number;
  readonly name: string;
  readonly overview: string | null;
  readonly parts: readonly {
    readonly id: number;
    readonly title: string;
    readonly year: number | null;
  }[];
}

interface CollectionRow {
  id: number;
  name: string;
  overview: string | null;
  parts: string;
}

interface OverrideRow {
  mode: 'none' | 'custom';
  name: string | null;
}

/**
 * What is known of movies' collections. The provider's side (`record`) is rewritten whenever the
 * details are read again; the owner's (`override`) is a separate table, so a refresh never
 * overwrites it. A row of a library takes both into account (`LibraryItemStore`), and a caller
 * that changes either asks it to refresh the movies concerned.
 */
export class CollectionStore {
  constructor(private readonly database: Database) {}

  /**
   * A movie's collection as the provider names it: `null` when the movie was read and has none
   * (a collection it left is forgotten), `undefined` when nothing was read (nothing changes).
   */
  record(movieId: number, collection: CollectionInfo | null | undefined): void {
    if (collection === undefined) {
      return;
    }
    this.database.transaction(() => {
      if (collection === null) {
        this.database.prepare('DELETE FROM movie_collections WHERE movie_id = ?').run(movieId);
        return;
      }
      this.database
        .prepare(
          `INSERT INTO collections (id, name, overview, parts) VALUES (?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET name = excluded.name, overview = excluded.overview,
             parts = excluded.parts`,
        )
        .run(
          collection.id.id,
          collection.name,
          collection.overview ?? null,
          JSON.stringify(
            collection.parts.map((part) => ({
              id: part.id.id,
              title: part.title,
              year: part.year ?? null,
            })),
          ),
        );
      this.database
        .prepare(
          `INSERT INTO movie_collections (movie_id, collection_id) VALUES (?, ?)
           ON CONFLICT (movie_id) DO UPDATE SET collection_id = excluded.collection_id`,
        )
        .run(movieId, collection.id.id);
    })();
  }

  get(id: number): StoredCollection | undefined {
    const row = this.database
      .prepare<[number], CollectionRow>(
        'SELECT id, name, overview, parts FROM collections WHERE id = ?',
      )
      .get(id);
    return row && { ...row, parts: JSON.parse(row.parts) as StoredCollection['parts'] };
  }

  /** The collection the provider files a movie under, if it was read. */
  ofMovie(movieId: number): StoredCollection | undefined {
    const row = this.database
      .prepare<[number], { collection_id: number }>(
        'SELECT collection_id FROM movie_collections WHERE movie_id = ?',
      )
      .get(movieId);
    return row && this.get(row.collection_id);
  }

  /** What the owner decided for a movie of a library; `undefined` means the provider's. */
  override(libraryId: string | null | undefined, movieId: number): CollectionOverride | undefined {
    if (!libraryId) {
      return undefined;
    }
    const row = this.database
      .prepare<[string, number], OverrideRow>(
        'SELECT mode, name FROM collection_overrides WHERE library_id = ? AND movie_id = ?',
      )
      .get(libraryId, movieId);
    if (!row) {
      return undefined;
    }
    return row.mode === 'none' ? { mode: 'none' } : { mode: 'custom', name: row.name ?? '' };
  }

  /** `undefined` brings the provider's collection back. */
  setOverride(
    libraryId: string,
    movieIds: readonly number[],
    override: CollectionOverride | undefined,
  ): void {
    this.database.transaction(() => {
      for (const movieId of movieIds) {
        if (override === undefined) {
          this.database
            .prepare('DELETE FROM collection_overrides WHERE library_id = ? AND movie_id = ?')
            .run(libraryId, movieId);
          continue;
        }
        this.database
          .prepare(
            `INSERT INTO collection_overrides (library_id, movie_id, mode, name) VALUES (?, ?, ?, ?)
             ON CONFLICT (library_id, movie_id) DO UPDATE SET mode = excluded.mode, name = excluded.name`,
          )
          .run(
            libraryId,
            movieId,
            override.mode,
            override.mode === 'custom' ? override.name.trim() : null,
          );
      }
    })();
  }

  /** The names of the owner's own collections in a library, for the shortcuts of the page. */
  customNames(libraryId: string): string[] {
    return this.database
      .prepare<[string], { name: string }>(
        `SELECT DISTINCT name FROM collection_overrides
         WHERE library_id = ? AND mode = 'custom' AND name IS NOT NULL ORDER BY name COLLATE NOCASE`,
      )
      .all(libraryId)
      .map(({ name }) => name);
  }
}

/** Whether a library files its movies under collections: it writes the NFO that says so. */
export const hasCollections = (library: LibraryConfig, config: Config): boolean =>
  library.type === 'movie' && buildProfile(libraryProfile(library, config)).nfo !== null;

/** What the owner picks for a movie: the provider's collection, none, or a name of their own. */
export type CollectionChoice =
  | { readonly mode: 'tmdb' }
  | { readonly mode: 'none' }
  | { readonly mode: 'custom'; readonly name: string };

/** NFO counted as they were handled; `kept` are the ones someone edited, which stay as they are. */
export interface CollectionResult {
  readonly movies: number;
  readonly rewritten: number;
  readonly unchanged: number;
  readonly kept: number;
  readonly missing: number;
  /** The batch to undo, when anything was rewritten. */
  readonly batchId: string | null;
}

export interface CollectionEditorDeps {
  readonly config: () => Config;
  readonly journal: Journal;
  readonly items: LibraryItemStore;
  readonly store: CollectionStore;
  /** A movie as its NFO is written (`Service.movie`). */
  readonly movie: (
    tmdbId: number,
  ) => Promise<{ details: MovieDetails; collection: CollectionInfo | null } | null>;
  readonly imageUrl: (path: string, size: ImageSize) => string;
  /** Where the NFO about to be replaced is kept, so that undo can bring it back. */
  readonly backupDir: string;
  /** A movie's folder changed: the media servers are asked to look at it again. */
  readonly changed?: (folder: { path: string; kind: 'movie' }) => void;
}

/**
 * Changes the collection of movies of a library: remembers the choice (apart from what the
 * provider says, so a refresh keeps it) and writes the NFO again. Nothing moves: only the `<set>`
 * of the NFO changes, and as an NFO is regenerated whole, one that was edited since is left alone.
 */
export class CollectionEditor {
  constructor(private readonly deps: CollectionEditorDeps) {}

  async apply(
    library: LibraryConfig,
    itemIds: readonly string[],
    choice: CollectionChoice,
  ): Promise<CollectionResult> {
    const { items, store } = this.deps;
    const config = this.deps.config();
    if (!hasCollections(library, config)) {
      throw new ApiError(409, 'library.no-collections');
    }
    if (choice.mode === 'custom' && choice.name.trim() === '') {
      throw new ApiError(422, 'collection.name-required');
    }
    const override: CollectionOverride | undefined =
      choice.mode === 'tmdb'
        ? undefined
        : choice.mode === 'none'
          ? { mode: 'none' }
          : { mode: 'custom', name: choice.name.trim() };

    // A file still to validate is no movie of the one its guess names.
    const rows = items
      .byItemIds(library.id, itemIds)
      .filter((row) => row.kind === 'movie' && row.tmdbId !== null && !isUnsettled(row));
    const movieIds = [...new Set(rows.flatMap((row) => (row.tmdbId === null ? [] : [row.tmdbId])))];
    if (movieIds.length === 0) {
      throw new ApiError(409, 'library.nothing-to-do');
    }

    // Everything the NFO needs is read before anything changes: a provider that does not answer
    // leaves the choice as it was.
    const loaded = new Map<number, MovieDetails>();
    for (const id of movieIds) {
      const movie = await this.deps.movie(id);
      if (!movie) {
        throw new ApiError(502, 'provider.movie-unknown');
      }
      store.record(id, movie.collection);
      loaded.set(id, movie.details);
    }
    store.setOverride(library.id, movieIds, override);
    items.refreshMovies(library.id, movieIds);

    const profile = buildProfile(libraryProfile(library, config));
    const batchId = randomUUID();
    const totals = { rewritten: 0, unchanged: 0, kept: 0, missing: 0 };
    const folders = new Set<string>();
    for (const id of movieIds) {
      const details = withCollection(loaded.get(id) as MovieDetails, override);
      const content = renderMovieNfo(details, {
        imageUrl: (path) => this.deps.imageUrl(path, 'preview'),
      });
      // The versions of a movie sit in its folder, and each folder holds one movie.
      const places = new Map<string, string[]>();
      for (const row of rows.filter((candidate) => candidate.tmdbId === id)) {
        const folder = dirname(row.path);
        for (const file of items
          .inFolder(library.id, folder)
          .filter(
            (other) => other.kind === 'movie' && other.tmdbId === id && !isUnsettled(other),
          )) {
          places.set(folder, [
            ...(places.get(folder) ?? []),
            basename(file.path, extname(file.path)),
          ]);
        }
      }
      for (const [folder, stems] of places) {
        const paths = expectedNfoPaths(
          profile,
          'movie',
          // A movie directly in the library's folder has none of its own: nothing is shared.
          folder === resolve(library.source) ? [] : [folder],
          stems,
        );
        for (const destination of paths) {
          const result = await rewriteNfo({
            journal: this.deps.journal,
            batchId,
            destination,
            content,
            backupDir: this.deps.backupDir,
          });
          totals[result] += 1;
          if (result === 'rewritten') {
            folders.add(folder);
          }
        }
      }
    }
    for (const path of folders) {
      this.deps.changed?.({ path, kind: 'movie' });
    }
    return {
      movies: movieIds.length,
      ...totals,
      batchId: totals.rewritten > 0 ? batchId : null,
    };
  }
}
