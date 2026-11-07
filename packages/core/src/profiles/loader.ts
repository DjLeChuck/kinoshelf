import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { errnoCode, KinoshelfError } from '../errors.js';
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
  if (templates.episodeVersion !== undefined) {
    checkTemplate('templates.episodeVersion', templates.episodeVersion, {
      allowed: VARIABLES.episodeVersion,
      folder: false,
    });
  }
  if (templates.movieVersion !== undefined) {
    checkTemplate('templates.movieVersion', templates.movieVersion, {
      allowed: VARIABLES.movieVersion,
      folder: false,
    });
  }
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
    if (image.specialsName !== undefined) {
      checkTemplate(`artwork.${index}.specialsName`, image.specialsName, {
        allowed: [],
        folder: false,
      });
    }
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
    // The library quotes the offending lines after its first one: only the description is kept,
    // so pointing the loader at another file can never send that file's content back.
    throw new KinoshelfError(code, { detail: yamlError.message.split('\n')[0] ?? '' });
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
    templates: {
      movieFolder: file.templates.movieFolder,
      movieFile: file.templates.movieFile,
      ...(file.templates.movieVersion !== undefined && {
        movieVersion: file.templates.movieVersion,
      }),
      seriesFolder: file.templates.seriesFolder,
      seasonFolder: file.templates.seasonFolder,
      episodeFile: file.templates.episodeFile,
      ...(file.templates.episodeVersion !== undefined && {
        episodeVersion: file.templates.episodeVersion,
      }),
    },
    nfo: file.nfo && {
      format: file.nfo.format,
      movie: file.nfo.movie,
      episode: file.nfo.episode,
      ...(file.nfo.series !== undefined && { series: file.nfo.series }),
    },
    artwork: file.artwork.map((image) => ({
      kind: image.kind,
      name: image.name,
      ...(image.specialsName !== undefined && { specialsName: image.specialsName }),
      size:
        image.size ?? (image.kind === 'fanart' || image.kind === 'logo' ? 'original' : 'standard'),
    })),
    filesystem: file.filesystem,
  };
}

/** A profile is a few dozen lines; anything much bigger is not one. */
const MAX_PROFILE_BYTES = 64 * 1024;

/**
 * Profiles already parsed. A file the user can edit is checked by its size and date on each call
 * (one `stat`, instead of reading and parsing it for every request); a shipped one never changes.
 */
const parsed = new Map<string, { stamp: string; profile: Profile }>();
const MAX_CACHED_PROFILES = 64;

export async function loadProfileFile(path: string | URL): Promise<Profile> {
  let stamp = 'shipped';
  if (typeof path === 'string') {
    // Only a regular YAML file of a sane size is read: not a device (`/dev/zero` never ends), a
    // FIFO, or a large file of something else.
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || info.size > MAX_PROFILE_BYTES || !/\.ya?ml$/i.test(path)) {
      throw new KinoshelfError('profile.not-a-file', { path, max: MAX_PROFILE_BYTES / 1024 });
    }
    stamp = `${String(info.size)}:${String(info.mtimeMs)}`;
  }
  const key = String(path);
  const known = parsed.get(key);
  if (known?.stamp === stamp) {
    return known.profile;
  }
  const profile = parseProfile(await readFile(path, 'utf8'));
  if (parsed.size >= MAX_CACHED_PROFILES) {
    parsed.clear();
  }
  parsed.set(key, { stamp, profile });
  return profile;
}

// Same depth from `src/profiles` and `dist/profiles`: the YAML files ship next to the code.
const BUNDLED_DIR = new URL('../../profiles/', import.meta.url);

const PROFILE_ID = /^[a-z0-9-]+$/;

/** Ids of the profiles shipped with Kinoshelf, e.g. `plex`. */
export async function listBundledProfiles(): Promise<string[]> {
  return (await readdir(BUNDLED_DIR))
    .filter((name) => name.endsWith('.yaml'))
    .map((name) => name.slice(0, -'.yaml'.length))
    .sort();
}

/** Loads a shipped profile by id. The id is checked so it can never address another file. */
export async function loadBundledProfile(id: string): Promise<Profile> {
  if (!PROFILE_ID.test(id)) {
    throw new KinoshelfError('profile.unknown', { id });
  }
  try {
    return await loadProfileFile(new URL(`${id}.yaml`, BUNDLED_DIR));
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') {
      throw new KinoshelfError('profile.unknown', { id });
    }
    throw error;
  }
}

/** A path (contains a separator or ends in .yaml) or the id of a bundled profile. */
export function loadProfile(reference: string): Promise<Profile> {
  return /[\\/]|\.ya?ml$/i.test(reference)
    ? loadProfileFile(resolve(reference))
    : loadBundledProfile(reference);
}
