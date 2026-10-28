import type { Candidate } from '../types/provider.js';

/**
 * Brings titles to a comparable form: guessit and file names lose accents, apostrophes and
 * casing (`dune part two`, `d Amelie`), so both sides are flattened the same way.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** Similarity of two titles, from 0 (nothing in common) to 1 (identical once normalized). */
export function titleSimilarity(a: string, b: string): number {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  const longest = Math.max(left.length, right.length);
  return longest === 0 ? 0 : 1 - levenshtein(left, right) / longest;
}

/** Best similarity over the localized, original and alternative titles of a candidate. */
export function candidateTitleSimilarity(title: string, candidate: Candidate): number {
  return Math.max(
    ...[candidate.title, candidate.originalTitle, ...candidate.alternativeTitles].map((t) =>
      titleSimilarity(title, t),
    ),
  );
}
