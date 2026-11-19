/**
 * What says something of one video, not of the work. A name that uses one is the owner's to write,
 * a folder's included (`Dune (2021) - 2160p/`: one folder per version); the default naming uses none.
 */
const FILE_VARIABLES = [
  'screenSize',
  'source',
  'releaseGroup',
  'videoCodec',
  'audioCodec',
  'audioChannels',
  'audioLanguages',
  'hdr',
] as const;

/** The ones the file itself tells (ffprobe), not its name: reading them is what they cost. */
export const PROBE_VARIABLES: readonly string[] = [
  'videoCodec',
  'audioCodec',
  'audioChannels',
  'audioLanguages',
  'hdr',
];

/**
 * Variables that may have no value (an id or an episode title TMDB lacks, a size the name does not give). A template
 * leaves them out, with the separator before them, rather than failing: the others are required.
 */
export const OPTIONAL_VARIABLES: readonly string[] = ['imdb', 'episodeTitle', ...FILE_VARIABLES];

/** What says something of the work, in any name. */
const WORK_VARIABLES = ['title', 'year', 'tmdb', 'imdb'] as const;
/** A series' names also know where the episode is: any of them may use these. */
const SERIES_VARIABLES = ['season', 'episode', 'episodeTitle'] as const;

/**
 * Variables each profile template may use; anything else is rejected when loading a profile. Within
 * a type every name takes every variable of the type (a movie's, or a series'), the file's and the
 * folders': the owner decides what is useful where, `checkNaming` only asks each name to stay unique.
 */
export const VARIABLES = {
  movieFolder: [...WORK_VARIABLES, ...FILE_VARIABLES],
  movieFile: [...WORK_VARIABLES, ...FILE_VARIABLES],
  movieVersion: ['version'],
  episodeVersion: ['version'],
  seriesFolder: [...WORK_VARIABLES, ...SERIES_VARIABLES, ...FILE_VARIABLES],
  seasonFolder: [...WORK_VARIABLES, ...SERIES_VARIABLES, ...FILE_VARIABLES],
  episodeFile: [...WORK_VARIABLES, ...SERIES_VARIABLES, ...FILE_VARIABLES],
  nfoName: ['file'],
  artworkName: [],
  seasonArtworkName: ['season'],
  episodeArtworkName: ['file'],
} as const satisfies Record<string, readonly string[]>;
