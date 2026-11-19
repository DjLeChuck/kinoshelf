/**
 * What says something of one video, not of the work: a folder holds several versions of a work, so
 * only a file's name may carry them.
 */
const FILE_VARIABLES = ['screenSize', 'source', 'releaseGroup'] as const;

/**
 * Variables that may have no value (an id TMDB lacks, a size the name does not give). A template
 * leaves them out, with the separator before them, rather than failing: the others are required.
 */
export const OPTIONAL_VARIABLES: readonly string[] = ['imdb', ...FILE_VARIABLES];

/** Variables each profile template may use; anything else is rejected when loading a profile. */
export const VARIABLES = {
  movieFolder: ['title', 'year', 'tmdb', 'imdb'],
  movieFile: ['title', 'year', 'tmdb', 'imdb', ...FILE_VARIABLES],
  movieVersion: ['version'],
  episodeVersion: ['version'],
  seriesFolder: ['title', 'year', 'tmdb', 'imdb'],
  seasonFolder: ['title', 'year', 'tmdb', 'imdb', 'season'],
  episodeFile: [
    'title',
    'year',
    'tmdb',
    'imdb',
    'season',
    'episode',
    'episodeTitle',
    ...FILE_VARIABLES,
  ],
  nfoName: ['file'],
  artworkName: [],
  seasonArtworkName: ['season'],
  episodeArtworkName: ['file'],
} as const satisfies Record<string, readonly string[]>;
