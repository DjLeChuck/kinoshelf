import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  libraryProfile,
  loadProfile,
  showFileNames,
  type Config,
  type Profile,
} from '@kinoshelf/core';
import type { Database } from 'better-sqlite3';
import type { LibraryItem, LibraryItemStore } from './library-items.js';

/** The season number a row carries for the show's own files (a real season is 0 or more). */
const SHOW = -1;

/** `null`: the profile writes no such file for this level. */
type Presence = boolean | null;

export interface SeriesFilesRow {
  readonly nfo: Presence;
  readonly poster: Presence;
  readonly fanart: Presence;
}

interface Row {
  season: number;
  nfo: number | null;
  poster: number | null;
  fanart: number | null;
}

const flag = (value: number | null): Presence => (value === null ? null : value === 1);
const bit = (value: Presence): number | null => (value === null ? null : value ? 1 : 0);

/**
 * Which files of a show (`tvshow.nfo`, its poster and fanart) and of a season (its poster) are on
 * the disk, as last looked at. Disposable like the completeness counts: a missing row means "not
 * looked at yet", and the next scan or transfer fills it.
 */
export class SeriesFilesStore {
  constructor(private readonly database: Database) {}

  /** A library was looked at: what it holds replaces what was known of it, as a whole. */
  replace(
    libraryId: string,
    rows: readonly { tmdbId: number; season: number | null; files: SeriesFilesRow }[],
  ): void {
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM series_files WHERE library_id = ?').run(libraryId);
      const insert = this.database.prepare(
        `INSERT INTO series_files (library_id, tmdb_id, season, nfo, poster, fanart)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const { tmdbId, season, files } of rows) {
        insert.run(
          libraryId,
          tmdbId,
          season ?? SHOW,
          bit(files.nfo),
          bit(files.poster),
          bit(files.fanart),
        );
      }
    })();
  }

  /** The files of a show (`season` omitted) or of one of its seasons; `undefined` if not looked at. */
  get(libraryId: string, tmdbId: number, season?: number): SeriesFilesRow | undefined {
    const row = this.database
      .prepare<[string, number, number], Row>(
        `SELECT season, nfo, poster, fanart FROM series_files
         WHERE library_id = ? AND tmdb_id = ? AND season = ?`,
      )
      .get(libraryId, tmdbId, season ?? SHOW);
    return row && { nfo: flag(row.nfo), poster: flag(row.poster), fanart: flag(row.fanart) };
  }
}

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

/** A video that sits where the profile wants it: only there is a show's folder known. */
const placed = (item: LibraryItem): boolean =>
  item.kind === 'series' &&
  item.tmdbId !== null &&
  (item.state === 'ok' || item.state === 'incomplete');

type Found = { tmdbId: number; season: number | null; files: SeriesFilesRow };

/** Shows looked at at once: enough to hide a share's latency, few enough not to flood it. */
const LOOKUPS_AT_ONCE = 16;

/** `task` over `items`, `size` at a time, results in order. */
async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...(await Promise.all(items.slice(start, start + size).map(task))));
  }
  return results;
}

export interface SeriesFilesDeps {
  readonly config: () => Config;
  readonly items: LibraryItemStore;
  readonly store: SeriesFilesStore;
  readonly onError?: (error: unknown) => void;
  /** A library was looked at: its page can read the rows again. */
  readonly refreshed?: (libraryId: string) => void;
}

/**
 * Looks, after a scan or a change of a series library, for the files a profile writes at the
 * level of a show and of a season. The planner leaves out what is already there, so the plan of
 * one episode cannot say what the other episodes' show lacks: the disk can, and a handful of
 * `access` calls per show is all it costs. Never read when a page lists, only when rows change.
 */
export class SeriesFiles {
  private readonly dirty = new Set<string>();
  private loop: Promise<void> | undefined;

  constructor(private readonly deps: SeriesFilesDeps) {}

  /** The rows of a library changed: looked at once for the whole burst. */
  touch(libraryId: string): void {
    this.dirty.add(libraryId);
    this.loop ??= this.drain().finally(() => {
      this.loop = undefined;
    });
  }

  async idle(): Promise<void> {
    while (this.loop) {
      await this.loop;
    }
  }

  private async drain(): Promise<void> {
    // Lets the rest of a batch's patches land before looking.
    await new Promise((resolve) => setImmediate(resolve));
    while (this.dirty.size > 0) {
      const [libraryId] = this.dirty;
      if (libraryId === undefined) {
        return;
      }
      this.dirty.delete(libraryId);
      try {
        await this.refresh(libraryId);
      } catch (error) {
        this.deps.onError?.(error);
      }
    }
  }

  async refresh(libraryId: string): Promise<void> {
    const config = this.deps.config();
    const library = config.libraries?.find(({ id }) => id === libraryId);
    if (library?.type !== 'series') {
      return;
    }
    const profile = await loadProfile(libraryProfile(library, config));
    this.deps.store.replace(libraryId, await this.look(libraryId, profile));
    this.deps.refreshed?.(libraryId);
  }

  private async look(libraryId: string, profile: Profile): Promise<Found[]> {
    // Without a folder of its own a show shares every name with the others: nothing to tell.
    if (profile.templates.seriesFolder === '') {
      return [];
    }
    const names = showFileNames(profile);
    const seasonFolders = profile.templates.seasonFolder !== '';

    const shows = new Map<number, { dir: string; seasons: Map<number, string> }>();
    for (const item of this.deps.items.all(libraryId).filter(placed)) {
      const tmdbId = item.tmdbId ?? 0;
      const seasonDir = seasonFolders ? dirname(item.path) : undefined;
      const show = shows.get(tmdbId) ?? {
        dir: seasonDir === undefined ? dirname(item.path) : dirname(seasonDir),
        seasons: new Map<number, string>(),
      };
      if (seasonDir !== undefined && item.season !== null) {
        show.seasons.set(item.season, seasonDir);
      }
      shows.set(tmdbId, show);
    }

    const has = async (dir: string, name: string | undefined): Promise<Presence> =>
      name === undefined ? null : await exists(join(dir, name));
    // On a network share each `access` is a round trip: the shows are looked at side by side.
    const perShow = await inBatches([...shows], LOOKUPS_AT_ONCE, async ([tmdbId, show]) => {
      const [nfo, poster, fanart] = await Promise.all([
        has(show.dir, names.nfo),
        has(show.dir, names.poster),
        has(show.dir, names.fanart),
      ]);
      const own: Found = { tmdbId, season: null, files: { nfo, poster, fanart } };
      const seasons = await Promise.all(
        [...show.seasons].map(async ([season, dir]): Promise<Found> => ({
          tmdbId,
          season,
          files: { nfo: null, poster: await has(dir, names.seasonPoster(season)), fanart: null },
        })),
      );
      return [own, ...seasons];
    });
    const rows = perShow.flat();
    return rows;
  }
}
