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
import { clusterRelease, isTitledEpisode } from './release.js';

/**
 * - `compliant`: already where the profile wants it.
 * - `to-rename`: matched with confidence, ready to be organized.
 * - `conflict`: matched, but the plan holds it back (destination taken, name unbuildable…).
 * - `ambiguous`: candidates found, none convincing: needs a human.
 * - `unrecognized`: nothing to go on.
 */
/** How a planned item reads to a human: to rename, already as wanted, or blocked. */
export function classifyItem(item: PlanItem): Classification {
  return item.status === 'ready'
    ? 'to-rename'
    : item.status === 'in-place'
      ? 'compliant'
      : 'conflict';
}

export type Classification = 'compliant' | 'to-rename' | 'conflict' | 'ambiguous' | 'unrecognized';

export interface AnalysisEntry {
  readonly file: DiscoveredFile;
  /**
   * Which series of its release it belongs to: 0 for the one most episodes name, 1 and up for
   * the other series dropped in the same folder (matched among themselves, validated apart, and
   * still of that release). Always 0 for anything but a titled episode.
   */
  readonly cluster: number;
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
  /** Reads a picture size from a file, for a name that says none (see `PlannerOptions.sizeOf`). */
  readonly sizeOf?: (path: string) => Promise<string | undefined>;
  /** Whether a file is one Kinoshelf wrote and left alone (see `PlannerOptions.madeByUs`). */
  readonly madeByUs?: (path: string) => Promise<boolean>;
  /** Files matched at the same time (each may issue several provider requests). */
  readonly concurrency?: number;
  /** One more file matched; `file` is the one that just was. */
  readonly onProgress?: (done: number, total: number, file: DiscoveredFile) => void;
  /** One more file's name read by the parser (synchronous work: thousands of files take a while). */
  readonly onParsing?: (done: number, total: number) => void;
  /** Every name is read and the files grouped: matching against the provider begins. */
  readonly onMatching?: () => void;
  /** Every file is matched: the details of the works are fetched and the plan is built. */
  readonly onPlanning?: () => void;
}

/** Longest stretch of synchronous parsing before other work (requests, timers) may run. */
const PARSE_SLICE_MS = 20;

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

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

/** The series of a release, as groups of indexes into the analyzed files; the main one first. */
function clustersOf(members: readonly number[], parsedFiles: readonly ParsedMedia[]): number[][] {
  return clusterRelease(members.map((index) => parsedFiles[index] as ParsedMedia)).map((cluster) =>
    cluster.map((position) => members[position] as number),
  );
}

/** Episodes grouped by release; everything else (movies, loose files) is left out. */
function episodeReleases(
  files: readonly DiscoveredFile[],
  parsedFiles: readonly ParsedMedia[],
): number[][] {
  const groups = new Map<string, number[]>();
  files.forEach((file, index) => {
    if (isTitledEpisode(parsedFiles[index] as ParsedMedia)) {
      const group = groups.get(file.release) ?? [];
      group.push(index);
      groups.set(file.release, group);
    }
  });
  return [...groups.values()];
}

/**
 * What is matched together: the files of a release that name one series are one unit (one search,
 * one choice), every other file is a unit of its own. `clusterOf` numbers the series of a release,
 * 0 for the main one.
 */
function matchingUnits(
  files: readonly DiscoveredFile[],
  parsedFiles: readonly ParsedMedia[],
): { units: number[][]; clusterOf: Map<number, number> } {
  const clusterOf = new Map<number, number>();
  const units: number[][] = [];
  for (const members of episodeReleases(files, parsedFiles)) {
    clustersOf(members, parsedFiles).forEach((cluster, number) => {
      units.push(cluster);
      cluster.forEach((index) => clusterOf.set(index, number));
    });
  }
  files.forEach((_file, index) => {
    if (!clusterOf.has(index)) {
      units.push([index]);
    }
  });
  return { units, clusterOf };
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
  // Parsing is synchronous and a few milliseconds a file: a library of thousands would keep a
  // server from answering anything for the whole run, so the loop gets its turn between slices.
  const parsedFiles: ParsedMedia[] = [];
  let sliceStart = performance.now();
  for (const file of files) {
    parsedFiles.push({ ...options.parser.parse(file.parserPath), path: file.path });
    options.onParsing?.(parsedFiles.length, files.length);
    if (performance.now() - sliceStart > PARSE_SLICE_MS) {
      await yieldToEventLoop();
      sliceStart = performance.now();
    }
  }
  const { units, clusterOf } = matchingUnits(files, parsedFiles);
  options.onMatching?.();
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
  const matched = files.map((file, index) => ({
    file,
    cluster: clusterOf.get(index) ?? 0,
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
    ...(options.sizeOf && { sizeOf: options.sizeOf }),
    ...(options.madeByUs && { madeByUs: options.madeByUs }),
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
    return { ...entry, classification: classifyItem(item), item };
  });

  return { entries, plan };
}
