import { Matcher } from '../matching/matcher.js';
import type { MatchingConfig } from '../matching/config.js';
import { createPlan, type PlanInput } from '../planning/planner.js';
import type { MatchOutcome } from '../types/matching.js';
import type { ParsedMedia } from '../types/media.js';
import type { TransferMode } from '../types/operation.js';
import type { Parser } from '../types/parser.js';
import type { DestinationRoots, Plan, PlanItem } from '../types/plan.js';
import type { Profile } from '../types/profile.js';
import type { MetadataProvider } from '../types/provider.js';
import type { DiscoveredFile } from './discover.js';

/**
 * - `compliant`: already where the profile wants it.
 * - `to-rename`: matched with confidence, ready to be organized.
 * - `conflict`: matched, but the plan holds it back (destination taken, name unbuildable…).
 * - `ambiguous`: candidates found, none convincing: needs a human.
 * - `unrecognized`: nothing to go on.
 */
export type Classification = 'compliant' | 'to-rename' | 'conflict' | 'ambiguous' | 'unrecognized';

export interface AnalysisEntry {
  readonly file: DiscoveredFile;
  readonly parsed: ParsedMedia;
  readonly outcome: MatchOutcome;
  readonly classification: Classification;
  /** The plan item, for matched files. */
  readonly item?: PlanItem;
}

export interface Analysis {
  readonly entries: readonly AnalysisEntry[];
  readonly plan: Plan;
}

export interface AnalyzeOptions {
  readonly parser: Parser;
  readonly provider: MetadataProvider;
  readonly profile: Profile;
  readonly destinationRoot: DestinationRoots;
  readonly mode: TransferMode;
  readonly matching?: Partial<MatchingConfig>;
  readonly sidecarExtensions?: readonly string[];
  /** Files matched at the same time (each may issue several provider requests). */
  readonly concurrency?: number;
  readonly onProgress?: (done: number, total: number) => void;
}

/** Runs `task` over `items` with bounded concurrency, keeping the results in order. */
async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * parse → match → plan, for a set of files. Reads the disk and the provider, writes nothing.
 * Provider failures (bad key, network) abort the analysis; what was fetched stays cached by
 * the provider, so a retry resumes cheaply.
 */
export async function analyze(
  files: readonly DiscoveredFile[],
  options: AnalyzeOptions,
): Promise<Analysis> {
  const matcher = new Matcher(options.provider, options.matching);
  let done = 0;

  const matched = await mapLimited(files, options.concurrency ?? 4, async (file) => {
    // The parser reads context from the relative path; everything after that uses the
    // absolute one.
    const parsed: ParsedMedia = { ...options.parser.parse(file.parserPath), path: file.path };
    const outcome = await matcher.match(parsed);
    options.onProgress?.(++done, files.length);
    return { file, parsed, outcome };
  });

  const inputs: PlanInput[] = [];
  for (const entry of matched) {
    if (entry.outcome.status === 'matched') {
      inputs.push({ parsed: entry.parsed, candidate: entry.outcome.best.candidate });
    }
  }
  const plan = await createPlan(inputs, {
    profile: options.profile,
    destinationRoot: options.destinationRoot,
    mode: options.mode,
    ...(options.sidecarExtensions && { sidecarExtensions: options.sidecarExtensions }),
  });

  // Plan items follow the order of `inputs`, i.e. of the matched entries.
  let cursor = 0;
  const entries = matched.map((entry): AnalysisEntry => {
    if (entry.outcome.status !== 'matched') {
      return {
        ...entry,
        classification: entry.outcome.status === 'ambiguous' ? 'ambiguous' : 'unrecognized',
      };
    }
    const item = plan.items[cursor++];
    if (!item) {
      throw new Error('plan items out of step with matched files');
    }
    const classification: Classification =
      item.status === 'ready' ? 'to-rename' : item.status === 'in-place' ? 'compliant' : 'conflict';
    return { ...entry, classification, item };
  });

  return { entries, plan };
}
