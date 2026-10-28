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
  /** Bonus when the candidate's id was already present in the file names (0 otherwise). */
  readonly knownId: number;
}

export interface ScoredCandidate {
  readonly candidate: Candidate;
  /** 0–100. */
  readonly score: number;
  readonly breakdown: ScoreBreakdown;
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
