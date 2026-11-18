import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  addImdbRating,
  buildProfile,
  imdbIdOf,
  libraryProfile,
  rewriteNfo,
  seriesNfoName,
  type Config,
  type Journal,
  type LibraryConfig,
} from '@kinoshelf/core';
import { ApiError } from './api-error.js';
import { movieNfoPlaces } from './collections.js';
import { isUnsettled, type LibraryItemStore } from './library-items.js';
import type { ImdbRatings } from './imdb-ratings.js';
import { failureOf, type MatchFailure } from './matches.js';
import type { ProgressTracker } from './progress.js';

/**
 * NFO counted as they were handled:
 * - `rewritten`: IMDb's rating was added (the old NFO is kept, the batch can be undone);
 * - `already`: the NFO already carries an IMDb rating;
 * - `noRating`: the dataset has no rating for the work, so nothing is worth writing;
 * - `kept`: an NFO Kinoshelf did not write, or that was edited since: never overwritten;
 * - `missing`: no NFO yet ("Refresh" writes it, with the rating).
 */
export interface ImdbNfoCounts {
  rewritten: number;
  already: number;
  noRating: number;
  kept: number;
  missing: number;
}

export interface ImdbNfoResult extends ImdbNfoCounts {
  readonly works: number;
  /** The batch to undo, when anything was rewritten. */
  readonly batchId: string | null;
}

export interface ImdbNfoDeps {
  readonly config: () => Config;
  readonly journal: Journal;
  readonly items: LibraryItemStore;
  readonly ratings: Pick<ImdbRatings, 'figures' | 'rating'>;
  /** The folder of a show, or `undefined` while none of its videos is in place. */
  readonly showFolder: (library: LibraryConfig, tmdbId: number) => string | undefined;
  /** Where the NFO about to be replaced is kept, so that undo can bring it back. */
  readonly backupDir: string;
  /** Folders whose NFO changed: the media servers are asked to look at them again. */
  readonly changed?: (folders: { path: string; kind: 'movie' | 'series' }[]) => void;
}

const empty = (): ImdbNfoCounts => ({ rewritten: 0, already: 0, noRating: 0, kept: 0, missing: 0 });

/** The libraries that write NFO: the only ones with something to add a rating to. */
export const writesNfo = (library: LibraryConfig, config: Config): boolean =>
  library.type !== undefined && buildProfile(libraryProfile(library, config)).nfo !== null;

/**
 * Adds IMDb's rating to the NFO Kinoshelf wrote before the setting was on. **The one place an NFO
 * is rewritten for a reason other than the owner changing a collection**, on the same terms
 * (`rewriteNfo`): the NFO is generated whole again, only if Kinoshelf wrote it and nobody touched
 * it since, the old one goes to `<config>/replaced/` and the batch can be undone. It is asked
 * for, never run by itself; an NFO that already has the rating, or a work the dataset does not
 * know, is left alone.
 */
export class ImdbNfo {
  constructor(private readonly deps: ImdbNfoDeps) {}

  /** The setting is on and the dataset has been downloaded: otherwise there is nothing to add. */
  assertReady(): void {
    if (this.deps.config().imdbRatings !== true) {
      throw new ApiError(409, 'imdb.not-enabled');
    }
    if (this.deps.ratings.figures().entries === 0) {
      throw new ApiError(409, 'imdb.not-downloaded');
    }
  }

  /** The works of a library an NFO could be rewritten for: settled, identified, one per tmdb id. */
  works(library: LibraryConfig): number[] {
    const kind = library.type === 'series' ? 'series' : 'movie';
    return [
      ...new Set(
        this.deps.items
          .all(library.id)
          .filter((row) => row.kind === kind && row.tmdbId !== null && !isUnsettled(row))
          .map((row) => row.tmdbId as number),
      ),
    ];
  }

  /**
   * One work of a library: its NFO files (a movie's, one per version, or the show's), rewritten
   * under `batchId`. Resolves with what became of them.
   */
  async work(
    library: LibraryConfig,
    tmdbId: number,
    batchId: string,
    folders: Set<string>,
  ): Promise<ImdbNfoCounts> {
    const counts = empty();
    const config = this.deps.config();
    const profile = buildProfile(libraryProfile(library, config));
    const isSeries = library.type === 'series';
    const targets: { folder: string; path: string }[] = [];
    if (isSeries) {
      const folder = this.deps.showFolder(library, tmdbId);
      const name = seriesNfoName(profile);
      if (folder !== undefined && name !== undefined) {
        targets.push({ folder, path: join(folder, name) });
      }
    } else {
      const rows = this.deps.items
        .all(library.id)
        .filter((row) => row.kind === 'movie' && row.tmdbId === tmdbId && !isUnsettled(row));
      for (const [folder, paths] of movieNfoPlaces(
        this.deps.items,
        library,
        profile,
        rows,
        tmdbId,
      )) {
        targets.push(...paths.map((path) => ({ folder, path })));
      }
    }
    for (const target of targets) {
      const text = await readFile(target.path, 'utf8').catch(() => undefined);
      if (text === undefined) {
        counts.missing += 1;
        continue;
      }
      if (text.includes('name="imdb"')) {
        counts.already += 1;
        continue;
      }
      const imdbId = imdbIdOf(text);
      const rating = imdbId === undefined ? undefined : this.deps.ratings.rating(imdbId);
      const content = rating === undefined ? undefined : addImdbRating(text, rating);
      if (content === undefined) {
        counts.noRating += 1;
        continue;
      }
      const result = await rewriteNfo({
        journal: this.deps.journal,
        batchId,
        destination: target.path,
        content,
        backupDir: this.deps.backupDir,
      });
      if (result === 'rewritten') {
        counts.rewritten += 1;
        folders.add(target.folder);
      } else if (result === 'kept') {
        counts.kept += 1;
      } else if (result === 'missing') {
        counts.missing += 1;
      } else {
        counts.already += 1;
      }
    }
    return counts;
  }

  /** The works of a library (or the ones named), one batch for all. */
  async apply(
    library: LibraryConfig,
    options: {
      readonly tmdbIds?: readonly number[];
      readonly batchId?: string;
      readonly totals?: ImdbNfoCounts;
      readonly onWork?: (done: number, total: number) => void;
    } = {},
  ): Promise<ImdbNfoResult> {
    this.assertReady();
    const ids = options.tmdbIds ?? this.works(library);
    const batchId = options.batchId ?? randomUUID();
    const totals = options.totals ?? empty();
    const folders = new Set<string>();
    let done = 0;
    for (const id of ids) {
      const counts = await this.work(library, id, batchId, folders);
      for (const key of Object.keys(totals) as (keyof ImdbNfoCounts)[]) {
        totals[key] += counts[key];
      }
      done += 1;
      options.onWork?.(done, ids.length);
    }
    const kind = library.type === 'series' ? 'series' : 'movie';
    this.deps.changed?.([...folders].map((path) => ({ path, kind })));
    return { works: ids.length, ...totals, batchId: totals.rewritten > 0 ? batchId : null };
  }

  /** How many works a bulk run would look at, across the libraries that write NFO. */
  count(): number {
    const config = this.deps.config();
    return (config.libraries ?? [])
      .filter((library) => writesNfo(library, config))
      .reduce((sum, library) => sum + this.works(library).length, 0);
  }
}

export interface ImdbNfoTask {
  status: 'running' | 'done' | 'failed';
  done: number;
  total: number;
  startedAt: string;
  endedAt: string | null;
  /** What was handled, once the task ends. */
  result: (ImdbNfoCounts & { works: number; batchId: string | null }) | null;
  error: MatchFailure | null;
}

/**
 * The bulk run over every library that writes NFO: a task in the server's memory with its
 * progress (`progress` event), never inside a request, one at a time.
 */
export class ImdbNfoTasks {
  private latest: ImdbNfoTask | undefined;

  constructor(
    private readonly deps: {
      readonly writer: ImdbNfo;
      readonly config: () => Config;
      readonly progress: ProgressTracker;
      readonly log: {
        info(data: object, message: string): void;
        warn(data: object, message: string): void;
      };
      /** A scan, a transfer, a tidy-up or an undo runs: a file it is about to move must not change. */
      readonly busy: () => boolean;
    },
  ) {}

  task(): ImdbNfoTask | undefined {
    return this.latest;
  }

  /** Starts the run and answers at once. */
  start(): ImdbNfoTask {
    if (this.latest?.status === 'running') {
      throw new ApiError(409, 'maintenance.imdb-nfo-running');
    }
    if (this.deps.busy()) {
      throw new ApiError(409, 'maintenance.imdb-nfo-busy');
    }
    this.deps.writer.assertReady();
    const task: ImdbNfoTask = {
      status: 'running',
      done: 0,
      total: this.deps.writer.count(),
      startedAt: new Date().toISOString(),
      endedAt: null,
      result: null,
      error: null,
    };
    this.latest = task;
    this.deps.progress.announce();
    void this.run(task);
    return task;
  }

  private async run(task: ImdbNfoTask): Promise<void> {
    const config = this.deps.config();
    const batchId = randomUUID();
    const totals = empty();
    let works = 0;
    try {
      let before = 0;
      for (const library of (config.libraries ?? []).filter((item) => writesNfo(item, config))) {
        const result = await this.deps.writer.apply(library, {
          batchId,
          totals,
          onWork: (done) => {
            task.done = before + done;
            this.deps.progress.announce();
          },
        });
        before += result.works;
        works += result.works;
      }
      task.status = 'done';
      this.deps.log.info({ ...totals, works }, 'Added the IMDb ratings to the NFO');
    } catch (error) {
      task.status = 'failed';
      task.error = failureOf(error);
      // What was rewritten before the failure is journaled: it can be undone from the History.
      this.deps.log.warn({ error: task.error.code }, 'Adding the IMDb ratings to the NFO failed');
    }
    // Also after a failure: what was rewritten is in the batch, which the History can undo.
    task.result = { works, ...totals, batchId: totals.rewritten > 0 ? batchId : null };
    task.endedAt = new Date().toISOString();
    this.deps.progress.announce();
  }
}
