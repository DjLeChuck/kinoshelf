import type { DeliveryResult } from './delivery.js';

/** The two images a collection owns on a media server. */
export type CollectionImageType = 'poster' | 'fanart';

/** The media servers Kinoshelf can send a collection's images to. */
export type MediaServerKind = 'plex' | 'jellyfin';

/** What identifies a collection on a server: its name, the movies it holds, where they live. */
export interface CollectionTarget {
  readonly name: string;
  /** Titles of the library's movies in it: they tell apart two collections of the same name. */
  readonly titles: readonly string[];
  /** A folder of the movie library, as Kinoshelf sees it: Plex looks for it in the matching section. */
  readonly libraryPath: string;
}

export type FoundCollection =
  | { readonly status: 'found'; readonly id: string }
  /** The server does not know the collection (yet). */
  | { readonly status: 'missing' }
  | { readonly status: 'error'; readonly error: string };

export interface CollectionImage {
  readonly bytes: Uint8Array;
  readonly mime: 'image/jpeg' | 'image/png';
}

/** What a media server offers to set the image of a collection. */
export interface CollectionImageServer {
  readonly kind: MediaServerKind;
  find(target: CollectionTarget): Promise<FoundCollection>;
  /** `status` 404 in the answer: the collection is gone, so the id kept for it is stale. */
  upload(id: string, type: CollectionImageType, image: CollectionImage): Promise<DeliveryResult>;
}

/** Lower case, without accents or punctuation: how a title is compared with another. */
export const foldTitle = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export interface CollectionCandidate {
  readonly id: string;
  /** Titles of the movies the server files in it. */
  readonly titles: readonly string[];
}

/**
 * Which of several collections of the same name is ours: the one sharing the most movies with the
 * library's. A lone candidate is taken as it is (nothing to tell it from); with several and no
 * movie in common, none is, rather than a coin toss that would put the image on a stranger.
 */
export function pickCollection(
  candidates: readonly CollectionCandidate[],
  titles: readonly string[],
): string | undefined {
  if (candidates.length === 1) {
    return candidates[0]?.id;
  }
  const wanted = new Set(titles.map(foldTitle));
  let best: { id: string; shared: number } | undefined;
  for (const candidate of candidates) {
    const shared = candidate.titles.filter((title) => wanted.has(foldTitle(title))).length;
    if (shared > (best?.shared ?? 0)) {
      best = { id: candidate.id, shared };
    }
  }
  return best?.id;
}
