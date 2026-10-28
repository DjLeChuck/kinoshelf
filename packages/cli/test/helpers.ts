import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  Candidate,
  ExternalId,
  MetadataProvider,
  MovieCandidate,
  SeasonInfo,
  SeriesCandidate,
} from '@kinoshelf/core';
import { run, type CliDeps } from '../src/cli.js';

const created: string[] = [];

export async function makeDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'kinoshelf-cli-'));
  created.push(directory);
  return directory;
}

export async function cleanup(): Promise<void> {
  await Promise.all(created.splice(0).map((d) => rm(d, { recursive: true, force: true })));
}

export async function put(path: string, content = 'x'): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}

export const movie = (id: number, title: string, year: number): MovieCandidate => ({
  kind: 'movie',
  id: { provider: 'tmdb', id },
  title,
  originalTitle: title,
  alternativeTitles: [],
  year,
});

export const series = (id: number, title: string, year: number): SeriesCandidate => ({
  kind: 'series',
  id: { provider: 'tmdb', id },
  title,
  originalTitle: title,
  alternativeTitles: [],
  year,
});

/** Answers every search with the catalog entries whose title shares its first word. */
export class FakeProvider implements MetadataProvider {
  readonly name = 'fake';
  constructor(
    private readonly catalog: readonly Candidate[],
    private readonly seasons: Record<string, SeasonInfo> = {},
  ) {}

  private find(kind: Candidate['kind'], title: string): Candidate[] {
    const word = title.toLowerCase().split(' ')[0] ?? '';
    return this.catalog.filter((c) => c.kind === kind && c.title.toLowerCase().startsWith(word));
  }

  searchMovies(query: { title: string }): Promise<readonly MovieCandidate[]> {
    return Promise.resolve(this.find('movie', query.title) as MovieCandidate[]);
  }

  searchSeries(query: { title: string }): Promise<readonly SeriesCandidate[]> {
    return Promise.resolve(this.find('series', query.title) as SeriesCandidate[]);
  }

  getSeason(id: ExternalId, season: number): Promise<SeasonInfo | null> {
    return Promise.resolve(this.seasons[`${id.id}:${season}`] ?? null);
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

/** Runs the CLI in-process against a fake TMDB, with its own empty config directory. */
export async function harness(
  env: Record<string, string> = {},
  deps: Partial<CliDeps> = {},
  catalog: Candidate[] = CATALOG,
): Promise<Harness> {
  const configDir = await makeDir();
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
