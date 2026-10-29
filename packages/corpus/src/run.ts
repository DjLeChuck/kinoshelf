import {
  GuessitParser,
  Matcher,
  StaticAliases,
  type MatchOutcome,
  type MetadataProvider,
  type ParsedMedia,
} from '@kinoshelf/core';
import { DEFAULT_LANGUAGE, type CorpusEntry } from './entries.js';

/**
 * - `pass`: handled as expected.
 * - `wrong-match`: matched automatically to the wrong thing, or matched something that needed
 *   a human. Renaming files wrongly is what the whole design guards against.
 * - `missed`: should have matched but was sent to review. Safe, only less helpful.
 */
export type Verdict = 'pass' | 'wrong-match' | 'missed';

export interface Actual {
  readonly status: MatchOutcome['status'];
  readonly tmdb?: number;
  readonly title?: string;
  readonly year?: number;
  readonly kind?: string;
  readonly score?: number;
  readonly season?: number;
  readonly episodes: readonly number[];
}

export interface EntryResult {
  readonly entry: CorpusEntry;
  readonly verdict: Verdict;
  readonly actual: Actual;
  /** The best candidates and their scores, for calibration. */
  readonly candidates: readonly { tmdb: number; title: string; year?: number; score: number }[];
}

function judge(entry: CorpusEntry, actual: Actual): Verdict {
  const { expect } = entry;
  if (expect.status === 'review') {
    return actual.status === 'matched' ? 'wrong-match' : 'pass';
  }
  if (actual.status !== 'matched') {
    return 'missed';
  }
  const sameEpisodes =
    expect.episodes === undefined ||
    (actual.episodes.length === expect.episodes.length &&
      actual.episodes.every((n, i) => n === expect.episodes?.[i]));
  const right =
    actual.tmdb === expect.tmdb &&
    actual.kind === expect.kind &&
    (expect.season === undefined || actual.season === expect.season) &&
    sameEpisodes;
  return right ? 'pass' : 'wrong-match';
}

/** What the user would have taught Kinoshelf by validating this entry's file, if it says so. */
export function aliasesOf(entry: CorpusEntry, parsed: ParsedMedia): StaticAliases | undefined {
  if (!entry.alias || parsed.title === undefined) {
    return undefined;
  }
  return new StaticAliases([
    {
      kind: entry.alias.kind,
      title: parsed.title,
      ...(parsed.year !== undefined && { year: parsed.year }),
      id: { provider: 'tmdb', id: entry.alias.tmdb },
    },
  ]);
}

/** `providerFor` gives the provider for a metadata language; each is built once. */
export async function runCorpus(
  providerFor: (language: string) => MetadataProvider,
  entries: readonly CorpusEntry[],
): Promise<EntryResult[]> {
  const parser = new GuessitParser();
  const matchers = new Map<string, Matcher>();
  const results: EntryResult[] = [];

  for (const entry of entries) {
    const language = entry.language ?? DEFAULT_LANGUAGE;
    const parsed = parser.parse(entry.path);
    const aliases = aliasesOf(entry, parsed);
    let matcher = aliases ? undefined : matchers.get(language);
    if (!matcher) {
      matcher = new Matcher(providerFor(language), {}, aliases);
      if (!aliases) {
        matchers.set(language, matcher);
      }
    }
    const outcome = await matcher.match(parsed);
    const scored =
      outcome.status === 'matched'
        ? [outcome.best, ...outcome.others]
        : outcome.status === 'ambiguous'
          ? outcome.candidates
          : [];
    const best = outcome.status === 'matched' ? outcome.best : undefined;

    const actual: Actual = {
      status: outcome.status,
      episodes: parsed.episodes,
      ...(best && {
        tmdb: best.candidate.id.id,
        title: best.candidate.title,
        kind: best.candidate.kind,
        score: best.score,
        ...(best.candidate.year !== undefined && { year: best.candidate.year }),
      }),
      ...(parsed.season !== undefined && { season: parsed.season }),
    };
    results.push({
      entry,
      verdict: judge(entry, actual),
      actual,
      candidates: scored.slice(0, 3).map((s) => ({
        tmdb: s.candidate.id.id,
        title: s.candidate.title,
        score: s.score,
        ...(s.candidate.year !== undefined && { year: s.candidate.year }),
      })),
    });
  }
  return results;
}

export interface Summary {
  readonly total: number;
  readonly passed: number;
  readonly rate: number;
  readonly wrongMatches: number;
  readonly missed: number;
}

export function summarize(results: readonly EntryResult[]): Summary {
  const count = (verdict: Verdict): number => results.filter((r) => r.verdict === verdict).length;
  const passed = count('pass');
  return {
    total: results.length,
    passed,
    rate: results.length === 0 ? 0 : passed / results.length,
    wrongMatches: count('wrong-match'),
    missed: count('missed'),
  };
}
