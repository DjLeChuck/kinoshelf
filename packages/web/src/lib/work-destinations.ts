/** `GET /api/work-destinations`: a work tied to the library its files go to. */
export interface WorkDestination {
  readonly kind: 'movie' | 'series';
  readonly tmdbId: number;
  /** As a library holds it; `null` when no library has the work yet. */
  readonly title: string | null;
  readonly year: number | null;
  readonly libraryId: string;
  /** `null` once the library is deleted: the work then goes to the default one. */
  readonly library: string | null;
}

/** The work's name, or its TMDB id when no library holds it yet to give a title. */
export function workLabel(destination: WorkDestination): string {
  if (destination.title === null) {
    return `TMDB ${destination.tmdbId}`;
  }
  return destination.year === null
    ? destination.title
    : `${destination.title} (${destination.year})`;
}
