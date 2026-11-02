import { Matcher } from '../matching/matcher.js';
import type { MatchingConfig } from '../matching/config.js';
import { createPlan, type PlanInput } from '../planning/planner.js';
import type { MatchOutcome } from '../types/matching.js';
import type { ParsedMedia } from '../types/media.js';
import type { TransferMode } from '../types/operation.js';
import type { Parser } from '../types/parser.js';
import type { DestinationRoots, Plan, PlanItem } from '../types/plan.js';
import type { Profile } from '../types/profile.js';
import type { Candidate, MetadataProvider } from '../types/provider.js';
import type { DiscoveredFile } from './discover.js';
import { MetadataLoader } from './metadata.js';
import { isTitledEpisode, voteRelease } from './release.js';

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
  /**
   * Set aside from the episodes of its release: its title is not the one most of them carry
   * (another series dropped in the same folder). Matched on its own, but still of that release.
   */
  readonly detached: boolean;
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
  /** One more file matched; `file` is the one that just was. */
  readonly onProgress?: (done: number, total: number, file: DiscoveredFile) => void;
  /** Every file is matched: the details of the works are fetched and the plan is built. */
  readonly onPlanning?: () => void;
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

/** The vote of a release, in terms of indexes into the analyzed files. */
function voteMembers(
  members: readonly number[],
  parsedFiles: readonly ParsedMedia[],
): { agree: number[]; detached: number[] } {
  const { agree, detached } = voteRelease(
    members.map((index) => parsedFiles[index] as ParsedMedia),
  );
  return {
    agree: agree.map((position) => members[position] as number),
    detached: detached.map((position) => members[position] as number),
  };
}

/** Episodes grouped by release; everything else (movies, loose files) is left out. */
function episodeReleases(
  files: readonly DiscoveredFile[],
  parsedFiles: readonly ParsedMedia[],
): number[][] {
  const groups = new Map<string, number[]>();
  files.forEach((file, index) => {
    if (isTitledEpisode(parsedFiles[index] as ParsedMedia)) {
      groups.set(file.release, [...(groups.get(file.release) ?? []), index]);
    }
  });
  return [...groups.values()];
}

/**
 * What is matched together: the files of a release that agree on a series are one unit (one search,
 * one choice), every other file is a unit of its own, detached episodes included.
 */
function matchingUnits(
  files: readonly DiscoveredFile[],
  parsedFiles: readonly ParsedMedia[],
): number[][] {
  const grouped = new Set<number>();
  const units: number[][] = [];
  for (const members of episodeReleases(files, parsedFiles)) {
    const { agree } = voteMembers(members, parsedFiles);
    units.push(agree);
    agree.forEach((index) => grouped.add(index));
  }
  files.forEach((_file, index) => {
    if (!grouped.has(index)) {
      units.push([index]);
    }
  });
  return units;
}

/** Indexes of the episodes set aside from their release by the vote. */
function detachedFiles(
  files: readonly DiscoveredFile[],
  parsedFiles: readonly ParsedMedia[],
): Set<number> {
  return new Set(
    episodeReleases(files, parsedFiles).flatMap(
      (members) => voteMembers(members, parsedFiles).detached,
    ),
  );
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

  // Same language as matching: the provider's own default when none is given.
  const loader = new MetadataLoader({
    provider: options.provider,
    profile: options.profile,
    ...(options.matching?.language !== undefined && { language: options.matching.language }),
  });
  const concurrency = options.concurrency ?? 4;

  // The parser reads context from the relative path; everything after that uses the absolute one.
  const parsedFiles = files.map((file): ParsedMedia => ({
    ...options.parser.parse(file.parserPath),
    path: file.path,
  }));
  const units = matchingUnits(files, parsedFiles);
  const outcomes = new Array<MatchOutcome>(files.length);
  await mapLimited(units, concurrency, async (unit) => {
    const flat =
      unit.length === 1
        ? [await matcher.match(parsedFiles[unit[0] as number] as ParsedMedia)]
        : await matcher.matchRelease(unit.map((index) => parsedFiles[index] as ParsedMedia));
    unit.forEach((index, position) => {
      outcomes[index] = flat[position] as MatchOutcome;
      options.onProgress?.(++done, files.length, files[index] as DiscoveredFile);
    });
  });
  const detached = detachedFiles(files, parsedFiles);
  const matched = files.map((file, index) => ({
    file,
    detached: detached.has(index),
    parsed: parsedFiles[index] as ParsedMedia,
    outcome: outcomes[index] as MatchOutcome,
  }));

  // Everything is fetched before anything is planned: a provider failure aborts the analysis
  // instead of leaving a plan whose files lack their NFO.
  options.onPlanning?.();
  const picks: { parsed: ParsedMedia; candidate: Candidate }[] = [];
  for (const entry of matched) {
    if (entry.outcome.status === 'matched') {
      picks.push({ parsed: entry.parsed, candidate: entry.outcome.best.candidate });
    }
  }
  const inputs = await mapLimited(picks, concurrency, async (pick): Promise<PlanInput> => ({
    ...pick,
    ...(await loader.forCandidate(pick.candidate, pick.parsed)),
  }));
  const plan = await createPlan(inputs, {
    profile: options.profile,
    destinationRoot: options.destinationRoot,
    mode: options.mode,
    ...(loader.needsMetadata && { imageUrl: options.provider.imageUrl.bind(options.provider) }),
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
