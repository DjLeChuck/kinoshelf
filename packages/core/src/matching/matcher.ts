import type { MatchOutcome, ScoredCandidate } from '../types/matching.js';
import type { ParsedMedia } from '../types/media.js';
import type { Candidate, MetadataProvider, SearchQuery, SeasonInfo } from '../types/provider.js';
import type { AliasLookup } from './aliases.js';
import { DEFAULT_MATCHING_CONFIG, type MatchingConfig } from './config.js';
import { candidateKey, scoreCandidates } from './score.js';
import { candidateTitleSimilarity } from './title-similarity.js';

/** Turns a parsed file into a match against a metadata provider. */
export class Matcher {
  private readonly config: MatchingConfig;

  /** `aliases`: titles a human already tied to a work; the file is read as that work. */
  constructor(
    private readonly provider: MetadataProvider,
    config: Partial<MatchingConfig> = {},
    private readonly aliases?: AliasLookup,
  ) {
    this.config = { ...DEFAULT_MATCHING_CONFIG, ...config };
  }

  async match(parsed: ParsedMedia): Promise<MatchOutcome> {
    if (parsed.title === undefined || parsed.title.trim() === '') {
      return { status: 'unrecognized', reason: 'no-title' };
    }

    const candidates =
      (await this.aliased(parsed, parsed.title)) ?? (await this.search(parsed, parsed.title));
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

  /**
   * The work a human tied to this title, looked up by id and nothing else: the choice was made, so
   * it is not weighed against search results. It is still scored, so a season or an episode the
   * work does not have, or a year that disagrees, sends the file to review. `undefined` when there
   * is no alias, or the provider no longer knows the work.
   */
  private async aliased(parsed: ParsedMedia, title: string): Promise<Candidate[] | undefined> {
    // Ids in the names are their own hint (see `knownIds`); an unknown kind cannot tell which
    // alias is meant.
    if (!this.aliases || parsed.kind === 'unknown' || parsed.knownIds?.length) {
      return undefined;
    }
    const kind = parsed.kind === 'episode' ? 'series' : 'movie';
    const id = this.aliases.find({
      kind,
      title,
      ...(parsed.year !== undefined && { year: parsed.year }),
    });
    if (!id) {
      return undefined;
    }
    const language = this.config.language;
    const found =
      kind === 'movie'
        ? await this.provider.getMovie(id, language)
        : await this.provider.getSeries(id, language);
    // The file's own title becomes one the work answers to: that is what the alias says.
    return found
      ? [{ ...found, alternativeTitles: [...found.alternativeTitles, title] }]
      : undefined;
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
      .sort(
        (a, b) =>
          candidateTitleSimilarity(title, b, parsed.subtitle) -
          candidateTitleSimilarity(title, a, parsed.subtitle),
      )
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
