import { createHash } from 'node:crypto';
import type { SeasonInfo, SeriesDetails } from '@kinoshelf/core';
import type { Database } from '@kinoshelf/core';
import { versionRowOf, type LibraryItem, type LibraryItemStore } from './library-items.js';
import { coverageOf, type VersionCoverage } from './versions.js';

/**
 * - `present`: a file holds it.
 * - `missing`: the provider lists it, it has aired, no file holds it.
 * - `unaired`: not out yet (or no date): not missing.
 * - `extra`: a file claims it, the provider does not know it.
 */
export type EpisodeState = 'present' | 'missing' | 'unaired' | 'extra';

/** The NFO of some files: how many the profile wants and how many are there. */
export interface NfoTally {
  readonly expected: number;
  readonly present: number;
}

/** Each file is one version with its own NFO; a file whose profile writes none expects nothing. */
export const nfoTally = (items: readonly LibraryItem[]): NfoTally => ({
  expected: items.filter((item) => item.nfo !== null).length,
  present: items.filter((item) => item.nfo === true).length,
});

export interface EpisodeReport {
  readonly season: number;
  readonly episode: number;
  readonly title: string | null;
  readonly airDate: string | null;
  /** The provider's synopsis and length in minutes; `null` for a file it does not list. */
  readonly overview: string | null;
  readonly runtime: number | null;
  readonly state: EpisodeState;
  /**
   * The files that hold it, one per version (a multi-episode file is shared by its episodes);
   * none when it is missing or not out.
   */
  readonly versions: readonly LibraryItem[];
  readonly nfo: NfoTally;
}

export interface SeasonReport {
  readonly season: number;
  readonly name: string | null;
  readonly posterPath: string | null;
  readonly episodes: readonly EpisodeReport[];
  /** Each version of the show against the episodes of this season: absent here, it holds none. */
  readonly versions: readonly VersionCoverage[];
  readonly nfo: NfoTally;
  /** Always 0 for the specials (season 0): they are never counted. */
  readonly missing: number;
}

const last = (item: LibraryItem): number => item.episodeEnd ?? item.episode ?? 0;

/** The episodes of a show that a library holds, from its rows. */
const episodesOf = (items: readonly LibraryItem[]): LibraryItem[] =>
  items.filter((item) => item.season !== null && item.episode !== null);

/** Which episodes were there when a count was made: a different one means it is stale. */
export function signatureOf(items: readonly LibraryItem[]): string {
  const parts = episodesOf(items)
    .map((item) => `${String(item.season)}:${String(item.episode)}-${String(last(item))}`)
    .sort();
  return createHash('sha1').update(parts.join(',')).digest('hex').slice(0, 16);
}

/**
 * Sets what a library holds of a show against what the provider lists. Pure: the caller fetched
 * the seasons. An episode with no air date, or a future one, is not missing; the specials are
 * listed when present and never reported missing (making-ofs and bonuses are not owed).
 */
export function compare(
  items: readonly LibraryItem[],
  seasons: readonly SeasonInfo[],
  summaries: SeriesDetails['seasons'],
  today: string,
): SeasonReport[] {
  const held = episodesOf(items);
  const numbers = new Set([...seasons.map((s) => s.season), ...held.map((i) => i.season ?? 0)]);
  return [...numbers]
    .sort((a, b) => a - b)
    .flatMap((season): SeasonReport[] => {
      const known = seasons.find((candidate) => candidate.season === season);
      const files = held.filter((item) => item.season === season);
      const covering = (episode: number): LibraryItem[] =>
        files.filter((item) => (item.episode ?? 0) <= episode && episode <= last(item));
      // Several files may hold one episode (versions of it): they are one episode with each of
      // them listed, and none is taken for a file the provider does not know.
      const listed = (known?.episodes ?? []).map((info): EpisodeReport => {
        const holders = covering(info.episode);
        const aired = info.airDate !== undefined && info.airDate <= today;
        const base = {
          season,
          episode: info.episode,
          title: info.title ?? null,
          airDate: info.airDate ?? null,
          overview: info.overview ?? null,
          runtime: info.runtime ?? null,
          versions: holders,
          nfo: nfoTally(holders),
        };
        return holders.length === 0
          ? { ...base, state: season > 0 && aired ? 'missing' : 'unaired' }
          : { ...base, state: 'present' };
      });
      // The specials a library lacks are not worth listing; the ones it has are.
      const shown = season === 0 ? listed.filter(({ versions }) => versions.length > 0) : listed;
      const strays = new Map<number, LibraryItem[]>();
      for (const item of files) {
        if (!listed.some((entry) => entry.versions.includes(item))) {
          strays.set(item.episode ?? 0, [...(strays.get(item.episode ?? 0) ?? []), item]);
        }
      }
      const unknown = [...strays].map(([episode, versions]): EpisodeReport => ({
        season,
        episode,
        title: null,
        airDate: null,
        overview: null,
        runtime: null,
        state: 'extra',
        versions,
        nfo: nfoTally(versions),
      }));
      const episodes = [...shown, ...unknown].sort((a, b) => a.episode - b.episode);
      // TMDB lists a specials season for most shows; an empty one is noise, not information.
      if (season === 0 && episodes.length === 0) return [];
      const summary = summaries.find((candidate) => candidate.season === season);
      return [
        {
          season,
          name: summary?.name ?? null,
          posterPath: summary?.posterPath ?? null,
          episodes,
          versions: coverageOf(files.map(versionRowOf)),
          nfo: nfoTally(files),
          missing: episodes.filter(({ state }) => state === 'missing').length,
        },
      ];
    });
}

export const missingOf = (reports: readonly SeasonReport[]): number =>
  reports.reduce((total, { missing }) => total + missing, 0);

/** Episodes the provider lists (specials and files it does not know left out). */
export const knownOf = (reports: readonly SeasonReport[]): number =>
  reports
    .filter(({ season }) => season > 0)
    .reduce(
      (total, { episodes }) => total + episodes.filter(({ state }) => state !== 'extra').length,
      0,
    );

interface CountRow {
  missing: number;
  signature: string;
}

/** How many aired episodes each show lacks, as last counted. */
export class CompletenessStore {
  constructor(private readonly database: Database) {}

  get(libraryId: string, tmdbId: number): CountRow | undefined {
    return this.database
      .prepare<[string, number], CountRow>(
        'SELECT missing, signature FROM series_completeness WHERE library_id = ? AND tmdb_id = ?',
      )
      .get(libraryId, tmdbId);
  }

  put(libraryId: string, tmdbId: number, missing: number, signature: string): void {
    this.database
      .prepare(
        `INSERT INTO series_completeness (library_id, tmdb_id, missing, signature, computed_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (library_id, tmdb_id) DO UPDATE SET
           missing = excluded.missing, signature = excluded.signature,
           computed_at = excluded.computed_at`,
      )
      .run(libraryId, tmdbId, missing, signature, new Date().toISOString());
  }
}

/** What the provider says of a show: its seasons, and each one's episodes. */
export type SeasonsFetcher = (
  tmdbId: number,
) => Promise<{ details: SeriesDetails; seasons: readonly SeasonInfo[] } | null>;

export interface CompletenessDeps {
  readonly items: LibraryItemStore;
  readonly store: CompletenessStore;
  readonly fetch: SeasonsFetcher;
  /** The job queue is working: the network and the disk are not ours. */
  readonly busy: () => boolean;
  readonly today?: () => string;
  readonly onError?: (error: unknown) => void;
}

interface Wanted {
  readonly libraryId: string;
  readonly tmdbId: number;
}

/**
 * Counts the missing episodes of the shows of a library. A page that opens a show gets its report
 * at once (`report`); the rest is done in the background like `ProbeQueue`, only while no job
 * runs, so a scan never calls the provider more than it did. The count is kept with the signature
 * of the episodes it saw: a show whose files changed is counted again, any other is left alone.
 */
export class Completeness {
  private readonly waiting = new Map<string, Wanted>();
  /** Libraries whose files changed: looked at when the queue next runs, once for a whole batch. */
  private readonly dirty = new Set<string>();
  private loop: Promise<void> | undefined;
  private stopped = false;

  constructor(private readonly deps: CompletenessDeps) {}

  private today = (): string => this.deps.today?.() ?? new Date().toISOString().slice(0, 10);

  /** The files of a library changed: its shows are counted again when the queue has the time. */
  touch(libraryId: string): void {
    this.dirty.add(libraryId);
    this.kick();
  }

  /** A library left (deleted, or pointed elsewhere): what was waiting for it would count nothing. */
  forget(libraryId: string): void {
    this.dirty.delete(libraryId);
    for (const [key, wanted] of this.waiting) {
      if (wanted.libraryId === libraryId) {
        this.waiting.delete(key);
      }
    }
  }

  /** Queues the shows of a library whose count is missing or out of date. */
  enqueue(libraryId: string): void {
    this.collect(libraryId);
    this.kick();
  }

  private collect(libraryId: string): void {
    const byShow = new Map<number, LibraryItem[]>();
    for (const item of this.deps.items.all(libraryId)) {
      if (item.kind === 'series' && item.tmdbId !== null) {
        const files = byShow.get(item.tmdbId);
        if (files) {
          files.push(item);
        } else {
          byShow.set(item.tmdbId, [item]);
        }
      }
    }
    for (const [tmdbId, files] of byShow) {
      if (this.deps.store.get(libraryId, tmdbId)?.signature !== signatureOf(files)) {
        this.waiting.set(`${libraryId}\0${String(tmdbId)}`, { libraryId, tmdbId });
      }
    }
  }

  rebuild(libraryIds: readonly string[]): void {
    libraryIds.forEach((id) => {
      this.enqueue(id);
    });
  }

  kick(): void {
    if (this.loop || this.stopped || this.deps.busy()) {
      return;
    }
    this.loop = this.drain().finally(() => {
      this.loop = undefined;
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.idle();
  }

  async idle(): Promise<void> {
    while (this.loop) {
      await this.loop;
    }
  }

  get pending(): number {
    return this.waiting.size + this.dirty.size;
  }

  /**
   * The seasons of a show against its files, counted now and remembered. `null` when the provider
   * does not know the show; a provider failure throws (the page still shows the files).
   */
  async report(
    libraryId: string,
    tmdbId: number,
  ): Promise<{ details: SeriesDetails; seasons: SeasonReport[] } | null> {
    this.waiting.delete(`${libraryId}\0${String(tmdbId)}`);
    const known = await this.deps.fetch(tmdbId);
    if (!known) {
      return null;
    }
    const files = this.deps.items.ofShow(libraryId, tmdbId);
    const seasons = compare(files, known.seasons, known.details.seasons, this.today());
    this.deps.store.put(libraryId, tmdbId, missingOf(seasons), signatureOf(files));
    return { details: known.details, seasons };
  }

  private async drain(): Promise<void> {
    while (!this.stopped && !this.deps.busy()) {
      for (const libraryId of this.dirty) {
        this.dirty.delete(libraryId);
        this.collect(libraryId);
      }
      const next = this.waiting.entries().next();
      if (next.done) {
        return;
      }
      const [key, wanted] = next.value;
      this.waiting.delete(key);
      try {
        await this.report(wanted.libraryId, wanted.tmdbId);
      } catch (error) {
        // Not retried in a loop: the next scan or transfer asks again.
        this.deps.onError?.(error);
      }
    }
  }
}
