import { KinoshelfError } from '../errors.js';
import type { ErrorInfo } from '../types/errors.js';
import { buildProfile, DEFAULT_PROFILE_CHOICE } from './build.js';
import { CUSTOM_NAME_FIELDS, NAME_KINDS, type CustomNames } from './names.js';
import { checkTemplates } from './loader.js';
import { renderProfileTemplate, type TemplateVariables } from './template.js';

export { CUSTOM_NAME_FIELDS, NAME_KINDS, customizes, type CustomNames } from './names.js';

/** What a name must say for two works (or two episodes) never to share one. */
const REQUIRED: Readonly<Record<keyof CustomNames, string>> = {
  movieFolder: 'title',
  movieFile: 'title',
  seriesFolder: 'title',
  seasonFolder: 'season',
  episodeFile: 'episode',
};

export interface NamingExample {
  /** Folders then the file name, extension included, as the planner would write them. */
  readonly path: readonly string[];
}

export interface NamingPreview {
  /** A video that gave everything: ids, picture size, source, group. */
  readonly complete: { readonly movie: NamingExample; readonly episode: NamingExample };
  /** A video that gave only the work: what is optional is left out. */
  readonly bare: { readonly movie: NamingExample; readonly episode: NamingExample };
}

/** Something to look at, that does not stop the template from being used. */
export interface NamingWarning {
  readonly code: 'movie-file-not-in-folder-name';
  readonly params: Readonly<Record<string, string>>;
}

export interface NamingReport {
  readonly preview: NamingPreview;
  readonly warnings: readonly NamingWarning[];
}

const COMPLETE: TemplateVariables = {
  title: 'Dune',
  year: 2021,
  tmdb: 438631,
  imdb: 'tt1160419',
  screenSize: '2160p',
  source: 'Blu-ray',
  releaseGroup: 'GRP',
  season: 1,
  episode: 2,
  episodeTitle: 'Pilot',
};

const BARE: TemplateVariables = {
  title: 'Dune',
  year: 2021,
  tmdb: 438631,
  season: 1,
  episode: 2,
};

/**
 * Checks the names a library asks for, and shows what they give. Throws a {@link KinoshelfError}
 * when a name cannot be used: an unknown variable, a path that leaves the library, or one that would
 * give two works the same name. A name that is only unusual (a movie file that does not start with
 * its folder's name, which Jellyfin wants) is a warning of the report.
 */
export function checkNaming(names: CustomNames): NamingReport {
  for (const [kind, fields] of Object.entries(NAME_KINDS)) {
    const missing = fields.filter((field) => names[field] === undefined);
    if (missing.length > 0 && missing.length < fields.length) {
      throw new KinoshelfError('profile.names-incomplete', { kind, missing: missing.join(', ') });
    }
  }
  const profile = buildProfile({ ...DEFAULT_PROFILE_CHOICE, names });
  checkTemplates(profile);

  for (const field of CUSTOM_NAME_FIELDS) {
    const template = names[field];
    const variable = REQUIRED[field];
    if (template !== undefined && !template.includes(`{${variable}`)) {
      throw new KinoshelfError('profile.name-not-unique', { field, variable });
    }
  }

  const example = (
    variables: TemplateVariables,
  ): { movie: NamingExample; episode: NamingExample } => {
    const file = (template: string): string =>
      renderProfileTemplate(profile, template, variables).join('');
    const { templates } = profile;
    return {
      movie: {
        path: [
          ...renderProfileTemplate(profile, templates.movieFolder, variables),
          `${file(templates.movieFile)}.mkv`,
        ],
      },
      episode: {
        path: [
          ...renderProfileTemplate(profile, templates.seriesFolder, variables),
          ...renderProfileTemplate(profile, templates.seasonFolder, variables),
          `${file(templates.episodeFile)}.mkv`,
        ],
      },
    };
  };
  const preview: NamingPreview = { complete: example(COMPLETE), bare: example(BARE) };

  // Jellyfin takes a movie file for a version of the folder's movie only when it starts with the
  // folder's name; Plex does not care. The text around the variables is the owner's.
  const warnings: NamingWarning[] = [];
  for (const { movie } of [preview.complete, preview.bare]) {
    const file = movie.path[movie.path.length - 1] ?? '';
    const folder = movie.path.length > 1 ? (movie.path[movie.path.length - 2] ?? '') : '';
    if (folder !== '' && !file.startsWith(folder)) {
      warnings.push({ code: 'movie-file-not-in-folder-name', params: { folder, file } });
      break;
    }
  }
  return { preview, warnings };
}

/** The problem of a name set, as the error the edges translate; `null` when it can be used. */
export function namingProblem(names: CustomNames): ErrorInfo | null {
  try {
    checkNaming(names);
    return null;
  } catch (error) {
    if (error instanceof KinoshelfError) {
      return error.info;
    }
    throw error;
  }
}
