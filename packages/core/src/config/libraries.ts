import { basename } from 'node:path';
import { LIBRARY_ID_PATTERN, type Config, type ConfigEdit, type LibraryConfig } from './config.js';
import type { SettingsOverrides } from './settings.js';

/** What a library sets, as overrides for `resolveSettings`: the rest follows the config. */
export function libraryOverrides(library: LibraryConfig): SettingsOverrides {
  const { destination } = library;
  return {
    ...(typeof destination === 'string' && { dest: destination }),
    ...(typeof destination === 'object' && {
      destMovies: destination.movies,
      destSeries: destination.series,
    }),
    ...(library.profile !== undefined && { profile: library.profile }),
    ...(library.mode !== undefined && { mode: library.mode }),
    ...(library.threshold !== undefined && { threshold: library.threshold }),
  };
}

/** Sources of the libraries that ask to be watched. */
export function watchedFolders(config: Config): string[] {
  return (config.libraries ?? []).filter(({ watch }) => watch === true).map(({ source }) => source);
}

/** A readable id for a name, not already taken: `Films 4K!` → `films-4k`, then `films-4k-2`. */
export function libraryId(name: string, taken: ReadonlySet<string>): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = LIBRARY_ID_PATTERN.test(slug) ? slug : 'library';
  let id = base;
  for (let n = 2; taken.has(id); n++) {
    id = `${base}-${String(n)}`;
  }
  return id;
}

/**
 * `watch.folders` (older versions) become libraries that are watched, and the key goes away.
 * The libraries set no destination, profile or mode: they keep following the top-level ones, so
 * nothing changes for what is already running. Returns no edit once nothing is left to move.
 */
export function legacyWatchMigration(config: Config): ConfigEdit[] {
  const folders = config.watch?.folders;
  if (folders === undefined) {
    return [];
  }
  const libraries = [...(config.libraries ?? [])];
  const taken = new Set(libraries.map(({ id }) => id));
  for (const folder of folders) {
    const existing = libraries.find(({ source }) => source === folder);
    if (existing) {
      // Already a library: it only has to be watched.
      libraries[libraries.indexOf(existing)] = { ...existing, watch: true };
      continue;
    }
    const name = basename(folder.replace(/\/+$/, '')) || folder;
    const id = libraryId(name, taken);
    taken.add(id);
    libraries.push({ id, name, source: folder, watch: true });
  }
  return [{ path: ['libraries'], value: libraries }, { path: ['watch', 'folders'] }];
}
