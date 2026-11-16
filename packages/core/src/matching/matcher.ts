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

    const {
      files: [hinted = parsed],
      found,
    } = await this.resolveImdbIds([parsed]);
    const candidates = mergeCandidates(await this.search(hinted, parsed.title), found);
    if (candidates.length === 0) {
      return { status: 'unrecognized', reason: 'no-candidates' };
    }
    return this.decide(await this.rank(hinted, candidates));
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
    const { files: hintedFiles, found } = await this.resolveImdbIds(files);
    const candidates = mergeCandidates(
      await this.search(hintedFiles[files.indexOf(lead)] ?? lead, lead.title),
      found,
    );
    if (candidates.length === 0) {
      return files.map(() => ({ status: 'unrecognized', reason: 'no-candidates' }));
    }

    const ranked = await Promise.all(
      hintedFiles.map((file) =>
        file.title?.trim() ? this.rank(file, candidates) : Promise.resolve([]),
      ),
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

  /**
   * The IMDb ids the names carry, asked of the provider once each: what it answers joins the
   * candidates (so a work the title search misses is still weighed) and becomes a `knownIds`
   * entry, which `score` only believes when the title, season and year agree. An id the provider
   * does not know, or a provider with no such lookup, changes nothing.
   */
  private async resolveImdbIds(
    files: readonly ParsedMedia[],
  ): Promise<{ files: ParsedMedia[]; found: Candidate[] }> {
    const lookup = this.provider.findByImdbId?.bind(this.provider);
    const wanted = [...new Set(files.flatMap((file) => file.imdbIds ?? []))];
    if (lookup === undefined || wanted.length === 0) {
      return { files: [...files], found: [] };
    }

    const answers = new Map<string, Candidate>();
    await Promise.all(
      wanted.map(async (imdbId) => {
        const candidate = await lookup(imdbId, this.config.language);
        if (candidate) {
          answers.set(imdbId, candidate);
        }
      }),
    );
    return {
      files: files.map((file) => {
        const ids = (file.imdbIds ?? []).flatMap((imdbId) => {
          const candidate = answers.get(imdbId);
          return candidate ? [candidate.id] : [];
        });
        return ids.length === 0 ? file : { ...file, knownIds: [...(file.knownIds ?? []), ...ids] };
      }),
      found: [...answers.values()],
    };
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

    // The whole title (`Ça - Bienvenue à Derry`) is searched too: the short one (`Ça`) may not
    // bring the work back at all.
    const whole =
      parsed.subtitle !== undefined && title === parsed.title
        ? [`${title} ${parsed.subtitle}`]
        : [];
    const runAll = async (year: number | undefined): Promise<Candidate[]> => {
      const found = await Promise.all(
        [title, ...whole].map((t) => run({ ...query(year), title: t })),
      );
      const seen = new Set<string>();
      return found.flat().filter((c) => {
        const key = candidateKey(c);
        return !seen.has(key) && seen.add(key);
      });
    };

    const first = await runAll(parsed.year);
    if (first.length > 0 || parsed.year === undefined) {
      return first;
    }
    return runAll(undefined);
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
    // Each similarity is worked out once, not at every comparison of the sort.
    const likeliest = series
      .map((candidate) => ({
        candidate,
        similarity: candidateTitleSimilarity(readings, candidate),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.config.maxSeasonLookups)
      .map(({ candidate }) => candidate);
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

/** `extra` after `candidates`, a work already there left out. */
function mergeCandidates(candidates: Candidate[], extra: readonly Candidate[]): Candidate[] {
  const seen = new Set(candidates.map(candidateKey));
  return [
    ...candidates,
    ...extra.filter((c) => !seen.has(candidateKey(c)) && seen.add(candidateKey(c))),
  ];
}
