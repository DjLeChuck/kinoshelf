import { join } from 'node:path';
import type { Candidate, SeasonInfo } from '@kinoshelf/core';
import {
  FakeProvider as CoreFakeProvider,
  cleanup,
  makeDir,
  movie,
  put,
  series,
} from '@kinoshelf/core/testing';
import { run, type CliDeps } from '../src/cli.js';

export { cleanup, makeDir, movie, put, series };

/** Answers every search with the catalog entries whose title shares its first word. */
export class FakeProvider extends CoreFakeProvider {
  constructor(catalog: readonly Candidate[], seasons: Record<string, SeasonInfo> = {}) {
    super(catalog, seasons, ({ title }, candidate) =>
      candidate.title.toLowerCase().startsWith(title.toLowerCase().split(' ')[0] ?? ''),
    );
  }
}

export const CATALOG: Candidate[] = [
  movie(438631, 'Dune', 2021),
  movie(841, 'Dune', 1984),
  movie(289, 'Casablanca', 1942),
  series(136315, 'The Bear', 2022),
];

export const SEASONS: Record<string, SeasonInfo> = {
  '136315:3': {
    season: 3,
    episodes: [1, 2, 3, 4, 5].map((episode) => ({ season: 3, episode })),
  },
};

export interface Harness {
  readonly out: string[];
  readonly err: string[];
  readonly configDir: string;
  readonly provider: FakeProvider;
  /** Metadata languages the CLI asked the provider factory for. */
  readonly languages: string[];
  cli(...args: string[]): Promise<number>;
}

/** The profile most tests expect, written to a config file that does not set one. */
export const PINNED = 'naming: with-id\nmetadata: none\n';

/** Runs the CLI in-process against a fake TMDB, with its own empty config directory. */
export async function harness(
  env: Record<string, string> = {},
  deps: Partial<CliDeps> = {},
  catalog: Candidate[] = CATALOG,
): Promise<Harness> {
  const configDir = await makeDir();
  // The tests read names with the id and no metadata files; the defaults are no-id and nfo.
  await put(join(configDir, 'config.yaml'), PINNED);
  const out: string[] = [];
  const err: string[] = [];
  const provider = new FakeProvider(catalog, SEASONS);
  const languages: string[] = [];
  return {
    out,
    err,
    configDir,
    provider,
    languages,
    cli: (...args) =>
      run(['--config-dir', configDir, ...args], {
        env: { LANG: 'en_US.UTF-8', ...env },
        io: {
          out: (line) => out.push(line),
          err: (line) => err.push(line),
        },
        createProvider: ({ language }) => {
          languages.push(language);
          return provider;
        },
        ...deps,
      }),
  };
}
