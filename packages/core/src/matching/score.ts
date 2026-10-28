import type { ParsedMedia } from '../types/media.js';
import type { ScoreBreakdown, ScoredCandidate } from '../types/matching.js';
import type { Candidate, SeasonInfo } from '../types/provider.js';
import type { MatchingConfig } from './config.js';
import { candidateTitleSimilarity } from './title-similarity.js';

/** Seasons by candidate key; `null` means the provider has no such season. */
export type SeasonLookup = ReadonlyMap<string, SeasonInfo | null>;

export const candidateKey = (candidate: Candidate): string =>
  `${candidate.kind}:${candidate.id.provider}:${candidate.id.id}`;

// Release years differ between countries and festivals, so a movie tolerates a gap of one or
// two years better than a series, whose first air year is usually unambiguous.
const YEAR_CLOSENESS = {
  movie: [1, 0.7, 0.3],
  series: [1, 0.6],
} as const;

function yearCloseness(parsed: ParsedMedia, candidate: Candidate): number {
  if (parsed.year === undefined || candidate.year === undefined) {
    return 0.5; // Nothing to compare: neither a confirmation nor a contradiction.
  }
  return YEAR_CLOSENESS[candidate.kind][Math.abs(parsed.year - candidate.year)] ?? 0;
}

function kindCloseness(parsed: ParsedMedia, candidate: Candidate): number {
  if (parsed.kind === 'unknown') {
    return 0.5;
  }
  return (parsed.kind === 'movie') === (candidate.kind === 'movie') ? 1 : 0;
}

function episodeCloseness(
  parsed: ParsedMedia,
  candidate: Candidate,
  seasons: SeasonLookup,
): number {
  if (parsed.kind === 'unknown') {
    return 0.5;
  }
  if (parsed.kind === 'movie') {
    return candidate.kind === 'movie' ? 1 : 0;
  }
  if (candidate.kind !== 'series' || parsed.season === undefined) {
    return 0;
  }
  const season = seasons.get(candidateKey(candidate));
  if (!season) {
    return 0; // Missing season, or not looked up (the candidate was not a serious contender).
  }
  const available = new Set(season.episodes.map((e) => e.episode));
  return parsed.episodes.every((episode) => available.has(episode)) ? 1 : 0;
}

/** `1` the countries agree, `-1` both are known and differ, `0` nothing to compare. */
function countryAgreement(parsed: ParsedMedia, candidate: Candidate): -1 | 0 | 1 {
  if (parsed.country === undefined || !candidate.countries || candidate.countries.length === 0) {
    return 0;
  }
  return candidate.countries.includes(parsed.country) ? 1 : -1;
}

const knownIdMatches = (parsed: ParsedMedia, candidate: Candidate): boolean =>
  parsed.knownIds?.some(
    (known) => known.provider === candidate.id.provider && known.id === candidate.id.id,
  ) ?? false;

interface Raw {
  readonly candidate: Candidate;
  readonly similarity: number;
  readonly title: number;
  readonly year: number;
  readonly kind: number;
  readonly episodeExists: number;
  readonly country: number;
  readonly sum: number;
}

/**
 * Scores every candidate (0–100) and returns them best first.
 * Criteria: title similarity, year gap, movie/series consistency, season/episode existence,
 * margin over the runner-up, plus a guarded bonus for an id already present in the names.
 * An episode that does not exist, or an id in the names that the best candidate contradicts,
 * caps the scores just under the threshold.
 */
export function scoreCandidates(
  parsed: ParsedMedia,
  candidates: readonly Candidate[],
  seasons: SeasonLookup,
  config: MatchingConfig,
): ScoredCandidate[] {
  const { weights } = config;
  const title = parsed.title ?? '';

  const raws: Raw[] = candidates.map((candidate) => {
    const similarity = candidateTitleSimilarity(title, candidate);
    const agreement = countryAgreement(parsed, candidate);
    const parts = {
      title: weights.title * similarity,
      year: weights.year * yearCloseness(parsed, candidate),
      kind: weights.kind * kindCloseness(parsed, candidate),
      episodeExists: weights.episodeExists * episodeCloseness(parsed, candidate, seasons),
      // Part of the raw sum, so it also widens or narrows the gap with the runner-up.
      country:
        agreement === -1
          ? -config.country.penalty
          : agreement === 1 && similarity >= config.country.minTitleSimilarity
            ? config.country.bonus
            : 0,
    };
    return {
      candidate,
      similarity,
      ...parts,
      sum: parts.title + parts.year + parts.kind + parts.episodeExists + parts.country,
    };
  });

  const scored = raws.map((raw, index): ScoredCandidate => {
    const rivalBest = Math.max(...raws.filter((_, i) => i !== index).map((r) => r.sum));
    const gap = raws.length === 1 ? Infinity : raw.sum - rivalBest;
    const margin = weights.margin * Math.min(1, Math.max(0, gap / config.marginFullGap));

    // The id only counts when type and season/episode agree, the title is not alien and the
    // year (when both are known) does not contradict it.
    const knownId =
      knownIdMatches(parsed, raw.candidate) &&
      raw.kind > 0 &&
      raw.episodeExists > 0 &&
      raw.similarity >= config.knownId.minTitleSimilarity &&
      raw.year > 0
        ? config.knownId.bonus
        : 0;

    const breakdown: ScoreBreakdown = {
      title: raw.title,
      year: raw.year,
      kind: raw.kind,
      episodeExists: raw.episodeExists,
      margin,
      country: raw.country,
      knownId,
    };
    const total = Math.min(100, Math.round(raw.sum + margin + knownId));

    // A season/episode the provider does not know is a red flag (wrong series, or another
    // numbering): however well the title and year agree, a human must look at it.
    const episodeMissing =
      parsed.kind === 'episode' && raw.candidate.kind === 'series' && raw.episodeExists === 0;
    const score = episodeMissing ? Math.min(total, config.threshold - 1) : total;

    return { candidate: raw.candidate, score, breakdown };
  });

  const ranked = scored.sort((a, b) => b.score - a.score);

  // The names carry an id and the candidate it designates is in the results, yet something
  // else scores higher: the tag and the rest of the name disagree (e.g. `Dune (2021)
  // {tmdb-841}`, where 841 is the 1984 film). Neither can be trusted over the other, so
  // nothing may be decided automatically.
  const top = ranked[0];
  const hinted = ranked.some((s) => knownIdMatches(parsed, s.candidate));
  if (hinted && top && !knownIdMatches(parsed, top.candidate)) {
    return ranked.map((s) => ({ ...s, score: Math.min(s.score, config.threshold - 1) }));
  }
  return ranked;
}
