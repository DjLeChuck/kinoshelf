import type {
  Candidate,
  ExternalId,
  MetadataProvider,
  MovieCandidate,
  SearchQuery,
  SeasonInfo,
  SeriesCandidate,
} from '../src/index.js';

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
}
