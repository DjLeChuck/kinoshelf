import { LIBRARY_ID_PATTERN, type Config, type LibraryConfig } from './config.js';
import { DEFAULT_PROFILE_CHOICE, type ProfileChoice } from '../profiles/build.js';
import type { SettingsOverrides } from './settings.js';

/** The profile a library writes with: its own choices, else the global ones, else the defaults. */
export function libraryProfile(
  library: Pick<LibraryConfig, 'naming' | 'metadata'> | undefined,
  config: Pick<Config, 'naming' | 'metadata'>,
): ProfileChoice {
  return {
    naming: library?.naming ?? config.naming ?? DEFAULT_PROFILE_CHOICE.naming,
    metadata: library?.metadata ?? config.metadata ?? DEFAULT_PROFILE_CHOICE.metadata,
  };
}

/** Where a library's works are written: its own source if typed, else its arrival destinations. */
function destinationOverrides(
  library: LibraryConfig,
  libraries: readonly LibraryConfig[],
): SettingsOverrides {
  if (library.into === undefined) {
    // One root also for the other kind: a stray file in it is laid out in place, which the plan
    // shows before anything moves.
    return { dest: library.source };
  }
  const sourceOf = (id: string): string | undefined =>
    libraries.find((candidate) => candidate.id === id)?.source;
  const movies = sourceOf(library.into.movie);
  const series = sourceOf(library.into.series);
  return {
    ...(movies !== undefined && { destMovies: movies }),
    ...(series !== undefined && { destSeries: series }),
  };
}

/**
 * What a library sets, as overrides for `resolveSettings`: the rest follows the config. An arrival
 * folder sets no naming nor metadata: it is planned with the global ones until the user picks a destination
 * (the profile of that library is then the right one).
 */
export function libraryOverrides(
  library: LibraryConfig,
  libraries: readonly LibraryConfig[],
): SettingsOverrides {
  return {
    ...destinationOverrides(library, libraries),
    ...(library.naming !== undefined && { naming: library.naming }),
    ...(library.metadata !== undefined && { metadata: library.metadata }),
    ...(library.mode !== undefined && { mode: library.mode }),
    ...(library.threshold !== undefined && { threshold: library.threshold }),
  };
}

/** Roots the works end up in: the sources of the typed libraries (never an arrival folder). */
export function destinationRoots(config: Config): string[] {
  return (config.libraries ?? [])
    .filter(({ type }) => type !== undefined)
    .map(({ source }) => source);
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
