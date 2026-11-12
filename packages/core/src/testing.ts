import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  Candidate,
  CollectionInfo,
  MovieCollection,
  ExternalId,
  ImageCandidate,
  ImageSize,
  MetadataProvider,
  MovieCandidate,
  MovieDetails,
  SearchQuery,
  SeasonInfo,
  SeriesCandidate,
  SeriesDetails,
  WorkImages,
} from './index.js';

/**
 * Test doubles and scratch directories shared by the packages' suites (`@kinoshelf/core/testing`).
 * Nothing here is used by the application.
 */
export const movie = (
  id: number,
  title: string,
  year?: number,
  extra: Partial<MovieCandidate> = {},
): MovieCandidate => ({
  kind: 'movie',
  id: { provider: 'tmdb', id },
  title,
  originalTitle: title,
  alternativeTitles: [],
  ...(year !== undefined && { year }),
  ...extra,
});

export const series = (
  id: number,
  title: string,
  year?: number,
  extra: Partial<SeriesCandidate> = {},
): SeriesCandidate => ({
  kind: 'series',
  id: { provider: 'tmdb', id },
  title,
  originalTitle: title,
  alternativeTitles: [],
  ...(year !== undefined && { year }),
  ...extra,
});

export const season = (number: number, episodes: number[]): SeasonInfo => ({
  season: number,
  episodes: episodes.map((episode) => ({ season: number, episode })),
});

/** Provider double: a search answers with `catalog` entries of the right kind, filtered by `answer`. */
export class FakeProvider implements MetadataProvider {
  readonly name = 'fake';
  /** Collections by movie id and by collection id, for the tests that need them. */
  readonly movieCollections = new Map<number, MovieCollection>();
  readonly collectionInfos = new Map<number, CollectionInfo>();
  readonly calls: { method: string; query?: SearchQuery; id?: ExternalId; season?: number }[] = [];

  constructor(
    private readonly catalog: readonly Candidate[],
    private readonly seasons: Record<string, SeasonInfo | null> = {},
    /** Decides which catalog entries a query returns; default: all of them. */
    private readonly answer: (query: SearchQuery, candidate: Candidate) => boolean = () => true,
  ) {}

  searchMovies(query: SearchQuery): Promise<readonly MovieCandidate[]> {
    this.calls.push({ method: 'searchMovies', query });
    return Promise.resolve(
      this.catalog.filter((c): c is MovieCandidate => c.kind === 'movie' && this.answer(query, c)),
    );
  }

  searchSeries(query: SearchQuery): Promise<readonly SeriesCandidate[]> {
    this.calls.push({ method: 'searchSeries', query });
    return Promise.resolve(
      this.catalog.filter(
        (c): c is SeriesCandidate => c.kind === 'series' && this.answer(query, c),
      ),
    );
  }

  getSeason(seriesId: ExternalId, seasonNumber: number): Promise<SeasonInfo | null> {
    this.calls.push({ method: 'getSeason', id: seriesId, season: seasonNumber });
    return Promise.resolve(this.seasons[`${seriesId.id}:${seasonNumber}`] ?? null);
  }

  getMovieDetails(id: ExternalId): Promise<MovieDetails | null> {
    this.calls.push({ method: 'getMovieDetails', id });
    const found = this.catalog.find(
      (c): c is MovieCandidate => c.kind === 'movie' && c.id.id === id.id,
    );
    return Promise.resolve(
      found
        ? {
            kind: 'movie',
            id: found.id,
            title: found.title,
            originalTitle: found.originalTitle,
            genres: [],
            tags: [],
            studios: [],
            countries: [],
            cast: [],
            posterPath: '/poster.jpg',
            backdropPath: '/backdrop.jpg',
            logoPath: '/logo.png',
            directors: [],
            writers: [],
            ...(found.year !== undefined && { releaseDate: `${found.year}-01-01` }),
            ...(this.movieCollections.has(id.id) && {
              collection: this.movieCollections.get(id.id) as MovieCollection,
            }),
          }
        : null,
    );
  }

  getCollection(id: ExternalId): Promise<CollectionInfo | null> {
    this.calls.push({ method: 'getCollection', id });
    return Promise.resolve(this.collectionInfos.get(id.id) ?? null);
  }

  getSeriesDetails(id: ExternalId): Promise<SeriesDetails | null> {
    this.calls.push({ method: 'getSeriesDetails', id });
    const found = this.catalog.find(
      (c): c is SeriesCandidate => c.kind === 'series' && c.id.id === id.id,
    );
    return Promise.resolve(
      found
        ? {
            kind: 'series',
            id: found.id,
            title: found.title,
            originalTitle: found.originalTitle,
            genres: [],
            tags: [],
            studios: [],
            countries: [],
            cast: [],
            posterPath: '/poster.jpg',
            backdropPath: '/backdrop.jpg',
            logoPath: '/logo.png',
            seasons: [],
            ...(found.year !== undefined && { firstAirDate: `${found.year}-01-01` }),
          }
        : null,
    );
  }

  // The fake offers the same stills whatever the episode.
  listEpisodeImages(id: ExternalId, season: number): Promise<readonly ImageCandidate[] | null> {
    this.calls.push({ method: 'listEpisodeImages', id, season });
    return Promise.resolve([
      { path: '/still.jpg', width: 1920, height: 1080 },
      { path: '/still2.jpg', width: 1920, height: 1080 },
    ]);
  }

  listImages(id: ExternalId): Promise<WorkImages | null> {
    this.calls.push({ method: 'listImages', id });
    const one = (path: string, language?: string): ImageCandidate => ({
      path,
      ...(language && { language }),
      width: 1000,
      height: 1500,
    });
    return Promise.resolve({
      poster: [one('/poster.jpg', 'en'), one('/poster2.jpg')],
      fanart: [one('/backdrop.jpg'), one('/backdrop2.jpg', 'en')],
      logo: [one('/logo.png', 'en')],
    });
  }

  imageUrl(path: string, size: ImageSize): string {
    return `https://image.test/${size}${path}`;
  }
}

// Directories made by tests, shared by the packages' suites.
const created: string[] = [];

/**
 * A fresh empty directory, removed by `cleanup`; `base` picks the filesystem it lives on. Its name
 * is fixed: the parser reads the folder name too, and a random one (`kinoshelf-test-S86e68`) can
 * look like an episode marker and flip a test now and then.
 */
export async function makeDir(base = tmpdir()): Promise<string> {
  const root = await mkdtemp(join(base, 'kinoshelf-test-'));
  created.push(root);
  const directory = join(root, 'dir');
  await mkdir(directory);
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
