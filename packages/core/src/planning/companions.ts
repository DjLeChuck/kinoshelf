import { join } from 'node:path';
import { renderEpisodeNfo, renderMovieNfo, renderSeriesNfo } from '../nfo/nfo.js';
import { parseTemplate, renderProfileTemplate, templateVariables } from '../profiles/template.js';
import type { Details, ImageSize } from '../types/details.js';
import type { ParsedMedia } from '../types/media.js';
import type { Operation } from '../types/operation.js';
import type { ArtworkKind, ArtworkSpec, Profile } from '../types/profile.js';
import type { EpisodeInfo } from '../types/provider.js';

export interface CompanionInput {
  readonly parsed: ParsedMedia;
  /** What the provider knows of the work; without it nothing can be written. */
  readonly details?: Details;
  /** The episodes of the file, as the provider lists them. */
  readonly episodes?: readonly EpisodeInfo[];
}

export interface CompanionPlace {
  readonly root: string;
  /** Folder segments of the work (movie folder, or series folder), then of the season. */
  readonly workFolders: readonly string[];
  readonly seasonFolders: readonly string[];
  /** The video's file name without extension. */
  readonly stem: string;
}

export interface CompanionOptions {
  readonly profile: Profile;
  readonly imageUrl?: (path: string, size: ImageSize) => string;
}

/**
 * The files a profile wants next to a video: NFO and images. Pure: the details were fetched
 * beforehand, so planning stays off the network.
 *
 * A series-level file (`tvshow.nfo`, the show poster) comes back with every episode of the show;
 * the planner keeps the first and drops the rest, since it sees the whole batch.
 */
export function companionOperations(
  input: CompanionInput,
  place: CompanionPlace,
  options: CompanionOptions,
): Operation[] {
  const { details } = input;
  const { profile, imageUrl } = options;
  if (!details) {
    return [];
  }

  const render = (template: string, variables: Record<string, string | number>): string =>
    companionName(profile, template, variables);

  const operations: Operation[] = [];
  const flat = details.kind === 'movie' && place.workFolders.length === 0;
  // A series' own files and a season's poster belong to no single episode. A movie kept in several
  // versions shares its folder's poster and fanart (and a `movie.nfo`) between them.
  const shared =
    details.kind === 'series' || (!flat && profile.templates.movieVersion !== undefined);
  const write = (folders: readonly string[], name: string, content: string, own = false) => {
    operations.push({
      type: 'write-file',
      destination: join(place.root, ...folders, name),
      content,
      ...(shared && !own && { shared: true as const }),
    });
  };
  const download = (
    folders: readonly string[],
    name: string,
    path: string,
    size: ImageSize,
    own = false,
  ) => {
    if (imageUrl) {
      operations.push({
        type: 'download',
        url: imageUrl(path, size),
        destination: join(place.root, ...folders, name),
        ...(shared && !own && { shared: true as const }),
      });
    }
  };

  const nfoOptions = imageUrl ? { imageUrl: (path: string) => imageUrl(path, 'preview') } : {};
  const written = companionsWritten(profile, details.kind, flat);

  const { nfo } = profile;
  if (nfo) {
    if (details.kind === 'movie') {
      if (written.nfo) {
        write(
          place.workFolders,
          render(nfo.movie, { file: place.stem }),
          renderMovieNfo(details, nfoOptions),
          templateVariables(parseTemplate(nfo.movie)).includes('file'),
        );
      }
    } else {
      if (nfo.series !== undefined) {
        write(
          place.workFolders,
          render(nfo.series, { file: place.stem }),
          renderSeriesNfo(details, nfoOptions),
        );
      }
      const season = input.parsed.season;
      const episodes = (season === undefined ? [] : input.parsed.episodes).map(
        (episode): EpisodeInfo =>
          input.episodes?.find((known) => known.season === season && known.episode === episode) ?? {
            season: season ?? 0,
            episode,
          },
      );
      if (episodes.length > 0) {
        write(
          [...place.workFolders, ...place.seasonFolders],
          render(nfo.episode, { file: place.stem }),
          renderEpisodeNfo(details, episodes, nfoOptions),
          true,
        );
      }
    }
  }

  for (const image of profile.artwork) {
    if (image.kind === 'episode-thumb') {
      // One per video, named after it: a file holding several episodes takes the first one's still.
      const season = input.parsed.season;
      const path =
        details.kind === 'series' && season !== undefined
          ? input.parsed.episodes
              .map((episode) =>
                input.episodes?.find(
                  (known) => known.season === season && known.episode === episode,
                ),
              )
              .find((known) => known?.stillPath !== undefined)?.stillPath
          : undefined;
      if (path) {
        download(
          [...place.workFolders, ...place.seasonFolders],
          render(image.name, { file: place.stem }),
          path,
          image.size,
          true,
        );
      }
      continue;
    }
    if (image.kind === 'season-poster') {
      const season = input.parsed.season;
      const path =
        details.kind === 'series' && season !== undefined
          ? details.seasons.find((known) => known.season === season)?.posterPath
          : undefined;
      if (path && season !== undefined) {
        // In the show's folder, with its other files: Kodi's `season01-poster.jpg`.
        download(
          place.workFolders,
          render(seasonPosterTemplate(image, season), { season }),
          path,
          image.size,
        );
      }
      continue;
    }
    const path =
      image.kind === 'poster'
        ? details.posterPath
        : image.kind === 'logo'
          ? details.logoPath
          : details.backdropPath;
    // A show's images are its own, in its folder: only a movie can lack one, written flat.
    const folderOwned = written[image.kind];
    if (path && (details.kind === 'series' || folderOwned)) {
      download(place.workFolders, render(image.name, {}), path, image.size);
    }
  }
  return operations;
}

/** The name template of a season's poster: season 0 may have a name of its own. */
function seasonPosterTemplate(spec: ArtworkSpec, season: number): string {
  return season === 0 && spec.specialsName !== undefined ? spec.specialsName : spec.name;
}

/** A file a profile writes beside a video, as a library page counts it. */
export type CompanionKind = 'nfo' | 'poster' | 'fanart' | 'logo' | 'thumb';

/** The name a profile gives a file it writes beside a video (no folder in it). */
export function companionName(
  profile: Profile,
  template: string,
  variables: Readonly<Record<string, string | number>>,
): string {
  return renderProfileTemplate(profile, template, variables).join('');
}

/**
 * Which files a profile writes for one work of this kind. A movie written flat (no folder of its
 * own) gets no fixed-name file: `movie.nfo` or `poster.jpg` would be every movie's, so only a name
 * carrying the video's (`{file}.nfo`) is safe. For an episode only its own NFO and thumbnail are
 * counted: the show's and the seasons' files belong to no single video.
 */
export function companionsWritten(
  profile: Profile,
  kind: 'movie' | 'series',
  flat: boolean,
): Record<CompanionKind, boolean> {
  const { nfo } = profile;
  if (kind === 'series') {
    return {
      nfo: nfo !== null,
      poster: false,
      fanart: false,
      logo: false,
      thumb: profile.artwork.some((spec) => spec.kind === 'episode-thumb'),
    };
  }
  const has = (art: ArtworkKind): boolean => profile.artwork.some((spec) => spec.kind === art);
  return {
    thumb: false,
    nfo: nfo !== null && (!flat || templateVariables(parseTemplate(nfo.movie)).includes('file')),
    poster: !flat && has('poster'),
    fanart: !flat && has('fanart'),
    logo: !flat && has('logo'),
  };
}

/**
 * The NFO paths a profile wants for one work: `movie.nfo` is one file whatever the number of
 * versions, a `{file}.nfo` is one per video. The rule is the template's, so a movie is told from an
 * episode by nothing but its name: each video's stem goes through it and the duplicates collapse.
 * Empty when the profile writes no NFO, or a flat movie would get a name every movie shares.
 * `folders` is the one holding the videos (the movie's, or the season's), relative to the root.
 */
export function expectedNfoPaths(
  profile: Profile,
  kind: 'movie' | 'series',
  folders: readonly string[],
  stems: readonly string[],
): string[] {
  const { nfo } = profile;
  if (nfo === null || !companionsWritten(profile, kind, folders.length === 0).nfo) {
    return [];
  }
  const template = kind === 'movie' ? nfo.movie : nfo.episode;
  return [
    ...new Set(
      stems.map((stem) => join(...folders, companionName(profile, template, { file: stem }))),
    ),
  ];
}

/** What a library page reads of the NFO of a work: how many are wanted and how many exist. */
export interface NfoCoverage {
  readonly expected: readonly string[];
  readonly present: readonly string[];
}

/** `expected` against the disk, through `exists` so the caller owns the file system. */
export function nfoCoverage(
  expected: readonly string[],
  exists: (path: string) => boolean,
): NfoCoverage {
  return { expected, present: expected.filter(exists) };
}

/**
 * What a file beside a video is, by its name and the profile's templates; `undefined` for a file
 * the profile does not write per video (the show's `tvshow.nfo`, a season poster, anything else).
 */
export function companionKindOf(profile: Profile, fileName: string): CompanionKind | undefined {
  const { nfo } = profile;
  if (nfo !== null && fileName.endsWith('.nfo')) {
    const show =
      nfo.series === undefined ? undefined : companionName(profile, nfo.series, { file: '' });
    return fileName === show ? undefined : 'nfo';
  }
  const spec = profile.artwork.find(
    (candidate) =>
      candidate.kind !== 'season-poster' &&
      candidate.kind !== 'episode-thumb' &&
      companionName(profile, candidate.name, {}) === fileName,
  );
  if (spec?.kind === 'poster' || spec?.kind === 'fanart' || spec?.kind === 'logo') {
    return spec.kind;
  }
  return isEpisodeThumb(profile, fileName) ? 'thumb' : undefined;
}

/**
 * Whether a file beside a video is its thumbnail: the name carries the video's, so it is told by
 * what it is not (a season poster is the only other image written per video's folder) and by the
 * template's fixed part (`.jpg`).
 */
function isEpisodeThumb(profile: Profile, fileName: string): boolean {
  const spec = profile.artwork.find((candidate) => candidate.kind === 'episode-thumb');
  if (!spec) {
    return false;
  }
  const ending = companionName(profile, spec.name, { file: '' });
  if (fileName.length <= ending.length || !fileName.endsWith(ending)) {
    return false;
  }
  const season = profile.artwork.find((candidate) => candidate.kind === 'season-poster');
  if (!season) {
    return true;
  }
  // A series has far fewer than 100 seasons: this reads the template without parsing it again.
  const posters = Array.from({ length: 100 }, (_, number) =>
    companionName(profile, seasonPosterTemplate(season, number), { season: number }),
  );
  return !posters.includes(fileName);
}

/** The file name of an episode's thumbnail beside a video, `undefined` when the profile writes none. */
export function episodeThumbName(profile: Profile, stem: string): string | undefined {
  const spec = profile.artwork.find((candidate) => candidate.kind === 'episode-thumb');
  return spec && companionName(profile, spec.name, { file: stem });
}

/**
 * The names of a show's own files and of a season's poster, `undefined` when the profile writes
 * no such file.
 */
export function showFileNames(profile: Profile): {
  readonly nfo: string | undefined;
  readonly poster: string | undefined;
  readonly fanart: string | undefined;
  readonly logo: string | undefined;
  readonly seasonPoster: (season: number) => string | undefined;
} {
  const image = (kind: ArtworkKind, season = 0): string | undefined => {
    const spec = profile.artwork.find((candidate) => candidate.kind === kind);
    return spec && companionName(profile, seasonPosterTemplate(spec, season), { season });
  };
  return {
    nfo:
      profile.nfo?.series === undefined
        ? undefined
        : companionName(profile, profile.nfo.series, { file: '' }),
    poster: image('poster'),
    fanart: image('fanart'),
    logo: image('logo'),
    seasonPoster: (season) => image('season-poster', season),
  };
}
