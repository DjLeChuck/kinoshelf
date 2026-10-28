/** Variables each profile template may use; anything else is rejected when loading a profile. */
export const VARIABLES = {
  movieFolder: ['title', 'year', 'tmdb'],
  movieFile: ['title', 'year', 'tmdb'],
  seriesFolder: ['title', 'year', 'tmdb'],
  seasonFolder: ['title', 'year', 'tmdb', 'season'],
  episodeFile: ['title', 'year', 'tmdb', 'season', 'episode', 'episodeTitle'],
  nfoName: ['file'],
  artworkName: [],
  seasonArtworkName: ['season'],
} as const satisfies Record<string, readonly string[]>;
