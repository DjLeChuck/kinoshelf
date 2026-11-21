import { stat } from 'node:fs/promises';
import type { Entry } from './entries.js';
import {
  itemId,
  resolutionOfItem,
  type LibraryItem,
  type LibraryItemStore,
} from './library-items.js';

/**
 * - `same-file`: a file of the work in the library is the same file (same device and inode: a
 *   hardlink), so the arrival is certainly there already.
 * - `same-size`: a file of the work has exactly the same size in bytes: a copy, almost certainly.
 * - `other-version`: the work is there, in a file of another size: maybe another version, which
 *   only a human can tell. It is never offered as ready.
 */
export type DuplicateKind = 'same-file' | 'same-size' | 'other-version';

/** The file of the library an arrival duplicates, and why. */
export interface Duplicate {
  readonly kind: DuplicateKind;
  readonly path: string;
  readonly libraryId: string;
  /** The arrival's size, which `same-size` is about; `null` when the verdict does not use it. */
  readonly size: number | null;
}

/** Whether a verdict puts the arrival aside as already there (the other one asks a question). */
export const isPresent = (kind: DuplicateKind): boolean => kind !== 'other-version';

const overlaps = (item: LibraryItem, season: number, episodes: readonly number[]): boolean => {
  if (item.season !== season || item.episode === null) {
    return false;
  }
  const last = item.episodeEnd ?? item.episode;
  return episodes.some((episode) => episode >= (item.episode ?? 0) && episode <= last);
};

/**
 * Compares an arrival with what its destination library holds, as its last scan saw it. Only a
 * file the library identified (a `tmdb_id`) can stand for a work: one it could not recognise is
 * never a duplicate of anything.
 *
 * The inode is read with `stat` on the few files of the work and never stored: a share mounted
 * again changes it. The size is read the same way rather than from the snapshot, which may be
 * older than the file (or lack it, until the probe has read it).
 */
export class DuplicateFinder {
  constructor(private readonly store: LibraryItemStore) {}

  async verdict(entry: Entry, libraryId: string, tmdbId: number): Promise<Duplicate | null> {
    const { parsed } = entry;
    const same =
      parsed.kind === 'movie'
        ? this.store.ofMovie(libraryId, tmdbId)
        : parsed.kind === 'episode' && parsed.season !== undefined && parsed.episodes.length > 0
          ? this.store
              .ofShow(libraryId, tmdbId)
              .filter((item) => overlaps(item, parsed.season ?? 0, parsed.episodes))
          : [];
    if (same.length === 0) {
      return null;
    }
    const arrival = await stat(entry.path).catch(() => undefined);
    if (!arrival) {
      return null;
    }
    let sameSize: LibraryItem | undefined;
    let other: LibraryItem | undefined;
    for (const item of same) {
      const there = await stat(item.path, { bigint: true }).catch(() => undefined);
      // The file went since the scan: it is not there to be a duplicate of.
      if (!there) {
        continue;
      }
      if (there.dev === BigInt(arrival.dev) && there.ino === BigInt(arrival.ino)) {
        return { kind: 'same-file', path: item.path, libraryId, size: arrival.size };
      }
      if (Number(there.size) === arrival.size) {
        sameSize ??= item;
      }
      other ??= item;
    }
    if (sameSize) {
      return { kind: 'same-size', path: sameSize.path, libraryId, size: arrival.size };
    }
    return other ? { kind: 'other-version', path: other.path, libraryId, size: null } : null;
  }

  /** What the page of a library file needs to say and link to: its size, its row, its episode. */
  describe(
    libraryId: string,
    path: string,
  ): {
    resolution: string | null;
    itemId: string;
    tmdbId: number | null;
    title: string | null;
    season: number | null;
    episode: number | null;
  } {
    const item = this.store.get(libraryId, path);
    return {
      resolution: item ? resolutionOfItem(item) : null,
      itemId: itemId(path),
      tmdbId: item?.tmdbId ?? null,
      title: item?.title ?? null,
      season: item?.season ?? null,
      episode: item?.episode ?? null,
    };
  }
}
