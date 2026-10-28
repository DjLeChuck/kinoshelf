import type { MatchOutcome, ScoredCandidate } from '../types/matching.js';
import type { ParsedMedia } from '../types/media.js';
import type { Candidate, MetadataProvider, SearchQuery, SeasonInfo } from '../types/provider.js';
import { DEFAULT_MATCHING_CONFIG, type MatchingConfig } from './config.js';
import { candidateKey, scoreCandidates } from './score.js';
import { candidateTitleSimilarity } from './title-similarity.js';

/** Turns a parsed file into a match against a metadata provider. */
export class Matcher {
  private readonly config: MatchingConfig;

  constructor(
    private readonly provider: MetadataProvider,
    config: Partial<MatchingConfig> = {},
  ) {
    this.config = { ...DEFAULT_MATCHING_CONFIG, ...config };
  }

  async match(parsed: ParsedMedia): Promise<MatchOutcome> {
    if (parsed.title === undefined || parsed.title.trim() === '') {
      return { status: 'unrecognized', reason: 'no-title' };
    }

    const candidates = await this.search(parsed, parsed.title);
    if (candidates.length === 0) {
      return { status: 'unrecognized', reason: 'no-candidates' };
    }

    const seasons = await this.lookUpSeasons(parsed, candidates);
    const scored = scoreCandidates(parsed, candidates, seasons, this.config);

    const [best, ...others] = scored as [ScoredCandidate, ...ScoredCandidate[]];
    if (best.score >= this.config.threshold) {
      return { status: 'matched', best, others };
    }
    return {
      status: 'ambiguous',
      candidates: scored.slice(0, this.config.maxAmbiguousCandidates),
    };
  }

  /** Title + year first; a second search without the year when the first finds nothing. */
  private async search(parsed: ParsedMedia, title: string): Promise<Candidate[]> {
    const query = (year: number | undefined): SearchQuery => ({
      title,
      ...(year !== undefined && { year }),
      ...(this.config.language !== undefined && { language: this.config.language }),
    });

    const run = async (q: SearchQuery): Promise<Candidate[]> => {
      // An unknown kind (e.g. a date-based episode) is searched as both.
      const [movies, series] = await Promise.all([
        parsed.kind === 'episode' ? [] : this.provider.searchMovies(q),
        parsed.kind === 'movie' ? [] : this.provider.searchSeries(q),
      ]);
      return [...movies, ...series];
    };

    const first = await run(query(parsed.year));
    if (first.length > 0 || parsed.year === undefined) {
      return first;
    }
    return run(query(undefined));
  }

  /** Season lookups only for the likeliest series, plus the one whose id the names carry. */
  private async lookUpSeasons(
    parsed: ParsedMedia,
    candidates: readonly Candidate[],
  ): Promise<Map<string, SeasonInfo | null>> {
    const seasons = new Map<string, SeasonInfo | null>();
    if (parsed.kind !== 'episode' || parsed.season === undefined || parsed.title === undefined) {
      return seasons;
    }

    const title = parsed.title;
    const series = candidates.filter((c) => c.kind === 'series');
    const likeliest = [...series]
      .sort((a, b) => candidateTitleSimilarity(title, b) - candidateTitleSimilarity(title, a))
      .slice(0, this.config.maxSeasonLookups);
    const hinted = series.filter((c) =>
      parsed.knownIds?.some((known) => known.provider === c.id.provider && known.id === c.id.id),
    );

    const season = parsed.season;
    await Promise.all(
      [...new Set([...likeliest, ...hinted])].map(async (candidate) => {
        seasons.set(
          candidateKey(candidate),
          await this.provider.getSeason(candidate.id, season, this.config.language),
        );
      }),
    );
    return seasons;
  }
}
