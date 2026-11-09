import type { Profile } from '../types/profile.js';

/** Whether the `{tmdb-<id>}` tag is in the folder names (and the movie file). */
export type Naming = 'with-id' | 'no-id';

/** Whether NFO files and images are written beside the videos. */
export type Metadata = 'none' | 'nfo';

export const NAMINGS: readonly Naming[] = ['with-id', 'no-id'];
export const METADATAS: readonly Metadata[] = ['none', 'nfo'];

/** What an output profile is made of: two independent choices. */
export interface ProfileChoice {
  readonly naming: Naming;
  readonly metadata: Metadata;
}

export const DEFAULT_PROFILE_CHOICE: ProfileChoice = { naming: 'with-id', metadata: 'none' };

/**
 * Both Plex and Jellyfin read these names, so one library reads the same under either player (the
 * point of a two-axis profile): the only thing left to choose is the id tag and the metadata files.
 *
 * - The id is `{tmdb-<id>}`: Plex matches it in the movie and series folders, and Jellyfin reads
 *   `tmdb` as an alias of its `tmdbid` (in brackets, parentheses or braces). Jellyfin also wants a
 *   movie file to start with its folder's name, so the movie file carries it too.
 * - Episodes are `Show (2022) - s01e01`, ranges joined with `-e` (a `s01e04-e05` file gave two
 *   episodes in each player), in `Season 01` folders (the English word is mandatory for Plex).
 * - Several qualities of a work share its folder (or season folder): `<name> - 2160p`.
 * - Libraries are often shared over SMB: no character Windows cannot store.
 * - NFO is Kodi-format: `movie.nfo`, `tvshow.nfo`, `<video>.nfo`; Plex's agents ignore a season NFO.
 *   Images are `poster.jpg`, `background.jpg`, `logo.png`. A season's poster is Kodi's
 *   `season01-poster.jpg` in the show's folder (`season-specials-poster.jpg` for season 0): Jellyfin
 *   reads it, and so does Plex's NFO agent although its documentation says `Season01.jpg`. An
 *   episode's thumbnail is `<video>.jpg` beside it.
 */
export function buildProfile(choice: ProfileChoice): Profile {
  const tag = choice.naming === 'with-id' ? ' \\{tmdb-{tmdb}\\}' : '';
  return {
    id: `${choice.naming}.${choice.metadata}`,
    episodeRangeSeparator: '-e',
    templates: {
      movieFolder: `{title} ({year})${tag}`,
      movieFile: `{title} ({year})${tag}`,
      movieVersion: ' - {version}',
      seriesFolder: `{title} ({year})${tag}`,
      seasonFolder: 'Season {season:02}',
      episodeFile: '{title} ({year}) - s{season:02}e{episode:02}',
      episodeVersion: ' - {version}',
    },
    nfo:
      choice.metadata === 'nfo'
        ? { format: 'kodi', movie: 'movie.nfo', episode: '{file}.nfo', series: 'tvshow.nfo' }
        : null,
    artwork:
      choice.metadata === 'nfo'
        ? [
            { kind: 'poster', name: 'poster.jpg', size: 'standard' },
            { kind: 'fanart', name: 'background.jpg', size: 'original' },
            { kind: 'logo', name: 'logo.png', size: 'original' },
            {
              kind: 'season-poster',
              name: 'season{season:02}-poster.jpg',
              specialsName: 'season-specials-poster.jpg',
              size: 'standard',
            },
            // `<video>.jpg`: Kodi's `-thumb.jpg` suffix is not needed, both players take the bare
            // name (checked on Plex's NFO agent and Jellyfin). TMDB stills have no w780: original.
            { kind: 'episode-thumb', name: '{file}.jpg', size: 'original' },
          ]
        : [],
    filesystem: { forbidden: 'windows', replacement: '', maxSegmentBytes: 255 },
  };
}
