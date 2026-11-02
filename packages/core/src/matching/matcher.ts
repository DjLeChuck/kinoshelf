import type { MatchOutcome, ScoredCandidate } from '../types/matching.js';
import type { ParsedMedia } from '../types/media.js';
import type { Candidate, MetadataProvider, SearchQuery, SeasonInfo } from '../types/provider.js';
import { DEFAULT_MATCHING_CONFIG, type MatchingConfig } from './config.js';
import { candidateKey, scoreCandidates } from './score.js';
import { candidateTitleSimilarity, titleReadings } from './title-similarity.js';

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
    return this.decide(await this.rank(parsed, candidates));
  }

  /**
   * The episodes of one release, which all name the same series: one search for the lot, then each
   * file is scored against the same candidates (its season, episode and year still count). The
   * work is chosen once, on the average score over the files, and every file is judged against that
   * choice: a file whose score for it is too low (a season the work does not have) goes to review
   * alone. Outcomes follow the order of `files`.
   */
  async matchRelease(files: readonly ParsedMedia[]): Promise<MatchOutcome[]> {
    const lead = files.find((file) => file.title !== undefined && file.title.trim() !== '');
    if (lead?.title === undefined) {
      return files.map(() => ({ status: 'unrecognized', reason: 'no-title' }));
    }
    const candidates = await this.search(lead, lead.title);
    if (candidates.length === 0) {
      return files.map(() => ({ status: 'unrecognized', reason: 'no-candidates' }));
    }

    const ranked = await Promise.all(
      files.map((file) => (file.title?.trim() ? this.rank(file, candidates) : Promise.resolve([]))),
    );
    const totals = new Map<string, number>();
    for (const scored of ranked) {
      for (const { candidate, score } of scored) {
        const key = candidateKey(candidate);
        totals.set(key, (totals.get(key) ?? 0) + score);
      }
    }
    const [chosen] = [...totals].sort((a, b) => b[1] - a[1]).map(([key]) => key);

    return ranked.map((scored): MatchOutcome => {
      if (scored.length === 0) {
        return { status: 'unrecognized', reason: 'no-title' };
      }
      // The choice leads, whatever this file alone would have preferred.
      const pick = scored.find(({ candidate }) => candidateKey(candidate) === chosen);
      return this.decide(pick ? [pick, ...scored.filter((other) => other !== pick)] : scored);
    });
  }

  private async rank(
    parsed: ParsedMedia,
    candidates: readonly Candidate[],
  ): Promise<ScoredCandidate[]> {
    const seasons = await this.lookUpSeasons(parsed, candidates);
    return scoreCandidates(parsed, candidates, seasons, this.config);
  }

  private decide(scored: readonly ScoredCandidate[]): MatchOutcome {
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

    const readings = titleReadings(parsed);
    const series = candidates.filter((c) => c.kind === 'series');
    const likeliest = [...series]
      .sort((a, b) => candidateTitleSimilarity(readings, b) - candidateTitleSimilarity(readings, a))
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
