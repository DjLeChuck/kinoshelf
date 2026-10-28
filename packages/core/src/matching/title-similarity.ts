import type { Candidate } from '../types/provider.js';

function flatten(title: string, apostrophe: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, apostrophe)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Brings titles to a comparable form: guessit and file names lose accents, apostrophes and
 * casing (`dune part two`, `d Amelie`), so both sides are flattened the same way.
 */
export function normalizeTitle(title: string): string {
  return flatten(title, ' ');
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
  // An apostrophe is a word break in `d'Amélie` (file: `d Amelie`) but disappears in
  // `Hell's` (file: `Hells`): both readings are tried, the better one counts.
  const readings = (title: string): string[] => [flatten(title, ' '), flatten(title, '')];
  let best = 0;
  for (const left of readings(a)) {
    for (const right of readings(b)) {
      const longest = Math.max(left.length, right.length);
      if (longest > 0) {
        best = Math.max(best, 1 - levenshtein(left, right) / longest);
      }
    }
  }
  return best;
}

/**
 * Best similarity over the localized, original and alternative titles of a candidate. A
 * movie named `Title - Subtitle` is also read as the one title `Title Subtitle`, which is how
 * TMDB writes it (`Thor : Le Monde des ténèbres`).
 */
export function candidateTitleSimilarity(
  title: string,
  candidate: Candidate,
  subtitle?: string,
): number {
  const readings = subtitle === undefined ? [title] : [title, `${title} ${subtitle}`];
  return Math.max(
    ...[candidate.title, candidate.originalTitle, ...candidate.alternativeTitles].flatMap((t) =>
      readings.map((reading) => titleSimilarity(reading, t)),
    ),
  );
}
