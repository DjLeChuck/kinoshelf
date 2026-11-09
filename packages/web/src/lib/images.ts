import type { ImageKind } from './arrivals.js';

/** An image the provider offers, as `GET .../images` lists it (in the provider's order). */
export interface Candidate {
  readonly path: string;
  /** ISO 639-1; `null`: no text on it. */
  readonly language: string | null;
  readonly width: number;
  readonly height: number;
  readonly rating: number | null;
  readonly votes: number;
}

export interface CurrentImage {
  readonly size: number;
  readonly modified: number;
  readonly width: number | null;
  readonly height: number | null;
  /** The provider's path when the file in place is one of the offered images. */
  readonly path: string | null;
}

export interface ImageListing {
  readonly title: string | null;
  readonly year: number | null;
  readonly folder: string;
  readonly files: Record<ImageKind, string | null>;
  readonly current: Record<ImageKind, CurrentImage | null>;
  readonly candidates: Record<ImageKind, readonly Candidate[]>;
}

export interface ImageChoice {
  readonly type: ImageKind;
  readonly source: 'tmdb' | 'url';
  readonly value: string;
}

export const IMAGE_KINDS = ['poster', 'fanart', 'logo'] as const satisfies readonly ImageKind[];

/** What the dialog offers for an episode: one image, written for each of its versions. */
export const EPISODE_KINDS = ['thumb'] as const satisfies readonly ImageKind[];

/** What each tab draws: the grid's ratio and the narrowest a card may be. */
export const KIND_LAYOUT: Record<ImageKind, { ratio: string; min: number }> = {
  poster: { ratio: '2 / 3', min: 150 },
  fanart: { ratio: '16 / 9', min: 260 },
  logo: { ratio: '3 / 1', min: 220 },
  thumb: { ratio: '16 / 9', min: 260 },
};

/**
 * The provider's order is its own: the library's language first, then the images with no text,
 * then the rest; the most voted first inside each, then the best rated. Equal ones keep the
 * provider's order.
 */
export function sortCandidates(
  candidates: readonly Candidate[],
  language: string,
): readonly Candidate[] {
  const rank = (candidate: Candidate): number =>
    candidate.language === language ? 0 : candidate.language === null ? 1 : 2;
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (a, b) =>
        rank(a.candidate) - rank(b.candidate) ||
        b.candidate.votes - a.candidate.votes ||
        (b.candidate.rating ?? 0) - (a.candidate.rating ?? 0) ||
        a.index - b.index,
    )
    .map(({ candidate }) => candidate);
}

/** The languages the candidates carry, in the order they appear (`null` for no text). */
export function languagesOf(candidates: readonly Candidate[]): readonly (string | null)[] {
  return [...new Set(candidates.map(({ language }) => language))];
}

/** The two letters of a language setting (`fr-FR` gives `fr`). */
export const baseLanguage = (language: string | null | undefined): string =>
  (language ?? '').split('-')[0]?.toLowerCase() ?? '';

export const sizeLabel = (image: { width: number | null; height: number | null }): string =>
  image.width === null || image.height === null ? '' : `${image.width} × ${image.height}`;

/** Whether `value` is an address the server may be asked to download. */
export function isImageAddress(value: string): boolean {
  try {
    const { protocol } = new URL(value.trim());
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** What `POST .../images/preview` found at an address. */
export interface AddressPreview {
  readonly format: 'jpeg' | 'png';
  readonly width: number;
  readonly height: number;
  readonly size: number;
  /** The image as a `data:` address. */
  readonly data: string;
}
