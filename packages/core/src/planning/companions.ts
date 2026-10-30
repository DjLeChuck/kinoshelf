import { join } from 'node:path';
import { renderEpisodeNfo, renderMovieNfo, renderSeriesNfo } from '../nfo/nfo.js';
import { parseTemplate, renderTemplate, templateVariables } from '../profiles/template.js';
import type { Details, ImageSize } from '../types/details.js';
import type { ParsedMedia } from '../types/media.js';
import type { Operation } from '../types/operation.js';
import type { Profile } from '../types/profile.js';
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
    renderTemplate(parseTemplate(template), variables, {
      rules: profile.filesystem,
      rangeSeparator: profile.episodeRangeSeparator,
    }).join('');

  const operations: Operation[] = [];
  const write = (folders: readonly string[], name: string, content: string): void => {
    operations.push({
      type: 'write-file',
      destination: join(place.root, ...folders, name),
      content,
    });
  };
  const download = (folders: readonly string[], name: string, path: string, size: ImageSize) => {
    if (imageUrl) {
      operations.push({
        type: 'download',
        url: imageUrl(path, size),
        destination: join(place.root, ...folders, name),
      });
    }
  };

  const nfoOptions = imageUrl ? { imageUrl: (path: string) => imageUrl(path, 'preview') } : {};
  // A movie written flat has no folder of its own: a fixed name (`movie.nfo`, `poster.jpg`) would
  // be shared by every movie in the library, so only a name carrying the file name is safe.
  const flat = details.kind === 'movie' && place.workFolders.length === 0;

  const { nfo } = profile;
  if (nfo) {
    if (details.kind === 'movie') {
      const name = render(nfo.movie, { file: place.stem });
      if (!flat || templateVariables(parseTemplate(nfo.movie)).includes('file')) {
        write(place.workFolders, name, renderMovieNfo(details, nfoOptions));
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
        );
      }
    }
  }

  for (const image of profile.artwork) {
    if (image.kind === 'season-poster') {
      const season = input.parsed.season;
      const path =
        details.kind === 'series' && season !== undefined
          ? details.seasons.find((known) => known.season === season)?.posterPath
          : undefined;
      if (path && season !== undefined) {
        download(
          [...place.workFolders, ...place.seasonFolders],
          render(image.name, { season }),
          path,
          image.size,
        );
      }
      continue;
    }
    const path = image.kind === 'poster' ? details.posterPath : details.backdropPath;
    if (path && !flat) {
      download(place.workFolders, render(image.name, {}), path, image.size);
    }
  }
  return operations;
}
