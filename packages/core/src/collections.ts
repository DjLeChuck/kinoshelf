import type { MovieCollection, MovieDetails } from './types/details.js';

/**
 * What the owner decided about one movie's collection, kept apart from the provider's record so a
 * refresh never overwrites it. No override means the provider's collection.
 *
 * - `none`: filed under no collection, even though the provider names one.
 * - `custom`: a collection of the owner's own, which has no provider id.
 */
export type CollectionOverride =
  { readonly mode: 'none' } | { readonly mode: 'custom'; readonly name: string };

/**
 * The collection a movie is filed under, from the provider's and the owner's. Only one: Kodi and
 * Plex's NFO agent read a single `<set>` per movie. A custom override without a name says
 * nothing, so it is ignored rather than writing an empty tag.
 */
export function effectiveCollection(
  provider: MovieCollection | undefined,
  override?: CollectionOverride,
): MovieCollection | undefined {
  if (override?.mode === 'none') {
    return undefined;
  }
  if (override?.mode === 'custom') {
    const name = override.name.trim();
    if (name !== '') {
      return { name };
    }
  }
  return provider;
}

/** The movie with its effective collection, ready for the NFO writer. */
export function withCollection(details: MovieDetails, override?: CollectionOverride): MovieDetails {
  const collection = effectiveCollection(details.collection, override);
  const copy: { -readonly [K in keyof MovieDetails]: MovieDetails[K] } = { ...details };
  if (collection) {
    copy.collection = collection;
  } else {
    delete copy.collection;
  }
  return copy;
}
