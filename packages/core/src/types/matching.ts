import type { Candidate } from './provider.js';

/**
 * Score detail: each component is expressed in already-weighted points
 * (their sum gives `ScoredCandidate.score`). Weights live in a single config file.
 */
export interface ScoreBreakdown {
  readonly title: number;
  readonly year: number;
  readonly kind: number;
  readonly episodeExists: number;
  readonly margin: number;
  /**
   * Signed: a bonus when the country named in the file agrees with the candidate's, a penalty
   * when both are known and differ, 0 otherwise.
   */
  readonly country: number;
  /**
   * Signed: a bonus when the installment named in the file (`Vol.2`, `Part.2`) agrees with the
   * one in the candidate's title, a penalty when both name one and they differ, 0 otherwise.
   */
  readonly volume: number;
  /** Bonus when the candidate's id was already present in the file names (0 otherwise). */
  readonly knownId: number;
}

/** What keeps a candidate from a full score, for a human to read (translated at the edges). */
export type ScoreLimit =
  'title' | 'year' | 'kind' | 'country' | 'volume' | 'runner-up' | 'known-id' | 'installment-year';

export interface ScoredCandidate {
  readonly candidate: Candidate;
  /** 0–100. */
  readonly score: number;
  readonly breakdown: ScoreBreakdown;
  /** The provider has no such season for this series (not just the episode): set for an episode. */
  readonly seasonMissing?: true;
  /** Why it is not a full score; an unknown season or episode is `seasonMissing` and the breakdown. */
  readonly limits?: readonly ScoreLimit[];
}

/** Why nothing could be matched; translated at the edges. */
export type UnrecognizedReason = 'no-title' | 'no-candidates';

/** Outcome of matching one file. */
export type MatchOutcome =
  | {
      readonly status: 'matched';
      readonly best: ScoredCandidate;
      readonly others: readonly ScoredCandidate[];
    }
  /** Candidates found but score below the threshold: manual validation queue. */
  | { readonly status: 'ambiguous'; readonly candidates: readonly ScoredCandidate[] }
  | { readonly status: 'unrecognized'; readonly reason: UnrecognizedReason };
