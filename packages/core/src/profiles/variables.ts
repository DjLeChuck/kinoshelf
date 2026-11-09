/** Variables each profile template may use; anything else is rejected when loading a profile. */
export const VARIABLES = {
  movieFolder: ['title', 'year', 'tmdb'],
  movieFile: ['title', 'year', 'tmdb'],
  movieVersion: ['version'],
  episodeVersion: ['version'],
  seriesFolder: ['title', 'year', 'tmdb'],
  seasonFolder: ['title', 'year', 'tmdb', 'season'],
  episodeFile: ['title', 'year', 'tmdb', 'season', 'episode', 'episodeTitle'],
  nfoName: ['file'],
  artworkName: [],
  seasonArtworkName: ['season'],
  episodeArtworkName: ['file'],
} as const satisfies Record<string, readonly string[]>;
