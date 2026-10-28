import { readFile } from 'node:fs/promises';
import { parseDocument } from 'yaml';
import { KinoshelfError } from '../errors.js';
import type { Profile } from '../types/profile.js';
import { profileSchema, type ProfileFile } from './schema.js';
import { parseTemplate, templateVariables } from './template.js';
import { VARIABLES } from './variables.js';

interface TemplateShape {
  readonly allowed: readonly string[];
  /** Folder templates may contain `/`; file name templates may not. */
  readonly folder: boolean;
  readonly allowEmpty?: boolean;
}

function checkTemplate(field: string, source: string, shape: TemplateShape): void {
  const parsed = parseTemplate(source);

  for (const name of templateVariables(parsed)) {
    if (!shape.allowed.includes(name)) {
      throw new KinoshelfError('profile.unknown-variable', { field, variable: name });
    }
  }

  // Replace variables by a placeholder to inspect the literal path structure.
  const skeleton = parsed.tokens.map((t) => (t.kind === 'text' ? t.text : 'x')).join('');
  if (skeleton === '' && shape.allowEmpty) {
    return;
  }
  const segments = skeleton.split('/');
  const valid =
    (shape.folder || segments.length === 1) &&
    segments.every((s) => s !== '' && s !== '.' && s !== '..');
  if (!valid) {
    throw new KinoshelfError('profile.invalid-path', { field, template: source });
  }
}

function checkTemplates(file: ProfileFile): void {
  const { templates, nfo, artwork } = file;
  checkTemplate('templates.movieFolder', templates.movieFolder, {
    allowed: VARIABLES.movieFolder,
    folder: true,
    allowEmpty: true,
  });
  checkTemplate('templates.movieFile', templates.movieFile, {
    allowed: VARIABLES.movieFile,
    folder: false,
  });
  checkTemplate('templates.seriesFolder', templates.seriesFolder, {
    allowed: VARIABLES.seriesFolder,
    folder: true,
  });
  checkTemplate('templates.seasonFolder', templates.seasonFolder, {
    allowed: VARIABLES.seasonFolder,
    folder: true,
  });
  checkTemplate('templates.episodeFile', templates.episodeFile, {
    allowed: VARIABLES.episodeFile,
    folder: false,
  });

  if (nfo) {
    const shape = { allowed: VARIABLES.nfoName, folder: false };
    checkTemplate('nfo.movie', nfo.movie, shape);
    checkTemplate('nfo.episode', nfo.episode, shape);
    if (nfo.series !== undefined) {
      checkTemplate('nfo.series', nfo.series, shape);
    }
  }

  artwork.forEach((image, index) => {
    checkTemplate(`artwork.${index}.name`, image.name, {
      allowed: image.kind === 'season-poster' ? VARIABLES.seasonArtworkName : VARIABLES.artworkName,
      folder: false,
    });
  });
}

/** Parses and validates a profile from YAML text. Throws {@link KinoshelfError} when invalid. */
export function parseProfile(yamlText: string): Profile {
  const doc = parseDocument(yamlText, { uniqueKeys: true });

  const [yamlError] = doc.errors;
  if (yamlError) {
    // In a double-quoted YAML scalar `\{` is an invalid escape: templates need single quotes.
    const code =
      yamlError.code === 'BAD_DQ_ESCAPE' ? 'profile.double-quoted-escape' : 'profile.yaml-syntax';
    throw new KinoshelfError(code, { detail: yamlError.message });
  }

  const result = profileSchema.safeParse(doc.toJS());
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new KinoshelfError('profile.invalid', {
      path: issue?.path.join('.') ?? '',
      detail: issue?.message ?? '',
    });
  }

  const file = result.data;
  checkTemplates(file);

  return {
    id: file.id,
    name: file.name,
    episodeRangeSeparator: file.episodeRangeSeparator,
    templates: file.templates,
    nfo: file.nfo && {
      format: file.nfo.format,
      movie: file.nfo.movie,
      episode: file.nfo.episode,
      ...(file.nfo.series !== undefined && { series: file.nfo.series }),
    },
    artwork: file.artwork,
    filesystem: file.filesystem,
  };
}

export async function loadProfileFile(path: string | URL): Promise<Profile> {
  return parseProfile(await readFile(path, 'utf8'));
}
