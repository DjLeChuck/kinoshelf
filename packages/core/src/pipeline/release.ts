import { titleSimilarity } from '../matching/title-similarity.js';
import type { ParsedMedia } from '../types/media.js';

/**
 * How alike two titles of a folder must be to name the same series. `Friends`/`Friend` is a
 * typo of the release, `Lost`/`Lost Girl` is another show: `test/release.test.ts` pins both
 * sides. The corpus only shows the real folders stay whole (their titles are identical), so it
 * cannot tune this; a real folder that splits wrongly belongs in the corpus as a new entry.
 */
export const SAME_SERIES_SIMILARITY = 0.85;

/** An episode whose title says which series it belongs to. */
export function isTitledEpisode(parsed: ParsedMedia): boolean {
  return parsed.kind === 'episode' && parsed.title !== undefined && parsed.title.trim() !== '';
}

/**
 * Whether two episodes of a folder can be the same series: close titles, and no country on both
 * sides that differs (`The.Office.US` and `The.Office.UK` share a title, not a show). A country
 * on one side only says nothing.
 */
export function sameSeries(a: ParsedMedia, b: ParsedMedia): boolean {
  if (a.country !== undefined && b.country !== undefined && a.country !== b.country) {
    return false;
  }
  return titleSimilarity(a.title ?? '', b.title ?? '') >= SAME_SERIES_SIMILARITY;
}

/**
 * The episodes of one release split by the series most of them name: the indexes (into `episodes`)
 * of those that follow it, and of those that do not. The series is the reading the most episodes
 * can be taken for; ties go to the one seen first, so the result never depends on a race.
 */
export function voteRelease(episodes: readonly ParsedMedia[]): {
  agree: number[];
  detached: number[];
} {
  let winner = 0;
  let most = -1;
  episodes.forEach((reading, index) => {
    const support = episodes.filter((other) => sameSeries(reading, other)).length;
    if (support > most) {
      winner = index;
      most = support;
    }
  });
  const agree: number[] = [];
  const detached: number[] = [];
  episodes.forEach((episode, index) => {
    (sameSeries(episodes[winner] as ParsedMedia, episode) ? agree : detached).push(index);
  });
  return { agree, detached };
}

/**
 * Every series a release holds, as groups of indexes into `episodes`: the one most episodes name
 * first, then the vote is held again on those left out, and so on. Every episode lands in exactly
 * one group, so a folder of eight episodes of another show is one group, not eight strays.
 */
export function clusterRelease(episodes: readonly ParsedMedia[]): number[][] {
  const clusters: number[][] = [];
  let rest = episodes.map((_, index) => index);
  while (rest.length > 0) {
    const { agree, detached } = voteRelease(rest.map((index) => episodes[index] as ParsedMedia));
    clusters.push(agree.map((position) => rest[position] as number));
    rest = detached.map((position) => rest[position] as number);
  }
  return clusters;
}
