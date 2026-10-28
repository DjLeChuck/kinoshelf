/** Maximum points of each criterion; the five add up to 100. */
export interface ScoreWeights {
  readonly title: number;
  readonly year: number;
  readonly kind: number;
  readonly episodeExists: number;
  /** Gap with the second-best candidate. */
  readonly margin: number;
}

export interface MatchingConfig {
  /** Minimum score (0–100) for automatic processing; below it the file goes to validation. */
  readonly threshold: number;
  readonly weights: ScoreWeights;
  /** Raw-score gap (in points, out of 100 minus margin) that earns the full margin weight. */
  readonly marginFullGap: number;
  readonly knownId: {
    /** Points added when an id found in the file names matches the candidate. */
    readonly bonus: number;
    /** The bonus is withheld below this title similarity: a wrong id must not win on its own. */
    readonly minTitleSimilarity: number;
  };
  /**
   * The country named in the file (`The.Office.US`) against the candidate's countries.
   * Neutral when either side is unknown, which is always the case for movies on TMDB.
   */
  readonly country: {
    readonly bonus: number;
    readonly penalty: number;
    /** The bonus is withheld below this title similarity: a country must not rescue a title. */
    readonly minTitleSimilarity: number;
  };
  /** Candidates whose season is looked up (one request each, cached by the provider). */
  readonly maxSeasonLookups: number;
  /** Candidates reported when nothing reaches the threshold. */
  readonly maxAmbiguousCandidates: number;
  /** Language for provider searches, e.g. `fr`. */
  readonly language?: string;
}

/**
 * Starting values, meant to be calibrated on the corpus: this is the only place to tune
 * the scoring.
 */
export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
  threshold: 85,
  weights: { title: 45, year: 20, kind: 10, episodeExists: 10, margin: 15 },
  marginFullGap: 20,
  knownId: { bonus: 40, minTitleSimilarity: 0.4 },
  country: { bonus: 10, penalty: 15, minTitleSimilarity: 0.4 },
  maxSeasonLookups: 3,
  maxAmbiguousCandidates: 5,
};
