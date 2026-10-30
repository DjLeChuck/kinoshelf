import { randomUUID } from 'node:crypto';
import { lstat, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { KinoshelfError } from '../errors.js';
import { nearestExistingDevice } from '../execution/fs-ops.js';
import { parseTemplate, renderTemplate, type TemplateVariables } from '../profiles/template.js';
import type { Details, ImageSize } from '../types/details.js';
import type { ErrorInfo } from '../types/errors.js';
import type { ParsedMedia } from '../types/media.js';
import type { Operation, TransferMode } from '../types/operation.js';
import type { Conflict, DestinationRoots, Plan, PlanItem } from '../types/plan.js';
import type { Profile } from '../types/profile.js';
import type { Candidate, EpisodeInfo } from '../types/provider.js';
import { companionOperations } from './companions.js';
import { DEFAULT_SIDECAR_EXTENSIONS, findSidecars } from './sidecars.js';

/** A matched file, ready to be planned. `parsed.path` is the source file. */
export interface PlanInput {
  readonly parsed: ParsedMedia;
  readonly candidate: Candidate;
  readonly episodeTitle?: string;
  /**
   * What an NFO and the images are made of. Only read when the profile writes any; without it
   * the file is still renamed, just with nothing beside it.
   */
  readonly details?: Details;
  /** The provider's record of the file's episodes. */
  readonly episodes?: readonly EpisodeInfo[];
}

export interface PlannerOptions {
  readonly profile: Profile;
  readonly destinationRoot: DestinationRoots;
  readonly mode: TransferMode;
  readonly sidecarExtensions?: readonly string[];
  /** Turns an image path into a URL (`MetadataProvider.imageUrl`); no image is planned without. */
  readonly imageUrl?: (path: string, size: ImageSize) => string;
  readonly newId?: () => string;
  readonly now?: () => Date;
}

const blocked = (conflict: Conflict, base: Omit<PlanItem, 'status' | 'conflicts'>): PlanItem => ({
  ...base,
  status: 'conflict',
  conflicts: [conflict],
});

/** Target path segments (folders then file stem) for a matched file. */
function targetSegments(
  input: PlanInput,
  profile: Profile,
  extensionBytes: number,
): { folders: string[]; stem: string; workDepth: number } {
  const { parsed, candidate } = input;
  const variables: TemplateVariables = {
    title: candidate.title,
    year: candidate.year,
    tmdb: candidate.id.id,
    ...(parsed.season !== undefined && { season: parsed.season }),
    ...(parsed.episodes.length > 0 && { episode: parsed.episodes }),
    ...(input.episodeTitle !== undefined && { episodeTitle: input.episodeTitle }),
  };
  const context = {
    rules: profile.filesystem,
    rangeSeparator: profile.episodeRangeSeparator,
  };
  const render = (template: string, reserveBytes = 0): string[] =>
    renderTemplate(parseTemplate(template), variables, { ...context, reserveBytes });
  const { templates } = profile;

  if (candidate.kind === 'movie') {
    const folders = render(templates.movieFolder);
    return {
      folders,
      stem: render(templates.movieFile, extensionBytes).join(''),
      workDepth: folders.length,
    };
  }
  if (parsed.season === undefined || parsed.episodes.length === 0) {
    throw new KinoshelfError('plan.episode-numbers-missing');
  }
  const seriesFolders = render(templates.seriesFolder);
  return {
    folders: [...seriesFolders, ...render(templates.seasonFolder)],
    stem: render(templates.episodeFile, extensionBytes).join(''),
    workDepth: seriesFolders.length,
  };
}

/** Where this item stands relative to what already exists on disk. */
async function classify(
  source: string,
  destination: string,
  mode: TransferMode,
): Promise<{ status: 'ready' | 'in-place' } | { conflict: Conflict }> {
  if (resolve(source) === resolve(destination)) {
    return { status: 'in-place' };
  }
  const [sourceStat, destinationStat] = await Promise.all([
    stat(source).catch(() => null),
    lstat(destination).catch(() => null),
  ]);

  if (destinationStat) {
    // Same inode: already placed (e.g. by an earlier hardlink run), not a conflict.
    return sourceStat?.dev === destinationStat.dev && sourceStat.ino === destinationStat.ino
      ? { status: 'in-place' }
      : { conflict: { reason: 'destination-exists', path: destination } };
  }
  if (mode === 'hardlink' && sourceStat) {
    const device = await nearestExistingDevice(dirname(destination));
    if (device !== undefined && device !== sourceStat.dev) {
      return { conflict: { reason: 'hardlink-cross-device', path: destination } };
    }
  }
  return { status: 'ready' };
}

async function planItem(input: PlanInput, options: PlannerOptions, id: string): Promise<PlanItem> {
  const { profile, mode } = options;
  const source = resolve(input.parsed.path);
  const base = {
    id,
    parsed: input.parsed,
    externalId: input.candidate.id,
    operations: [] as Operation[],
  };
  const unresolvable = (detail: ErrorInfo): PlanItem =>
    blocked({ reason: 'unresolvable-name', path: source, detail }, base);

  const extension = input.parsed.extension ? `.${input.parsed.extension}` : '';
  let target: { folders: string[]; stem: string; workDepth: number };
  try {
    target = targetSegments(input, profile, Buffer.byteLength(extension));
  } catch (error) {
    if (error instanceof KinoshelfError) {
      return unresolvable(error.info);
    }
    throw error;
  }

  const segments = [...target.folders, target.stem];
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return unresolvable({ code: 'plan.unsafe-segment' });
  }
  const roots = options.destinationRoot;
  const root = resolve(
    typeof roots === 'string'
      ? roots
      : roots[input.candidate.kind === 'movie' ? 'movie' : 'series'],
  );
  const destination = join(root, ...target.folders, `${target.stem}${extension}`);
  if (!destination.startsWith(`${root}${sep}`)) {
    return unresolvable({ code: 'plan.outside-root' });
  }

  const state = await classify(source, destination, mode);
  if ('conflict' in state) {
    return blocked(state.conflict, base);
  }
  const place = {
    root,
    workFolders: target.folders.slice(0, target.workDepth),
    seasonFolders: target.folders.slice(target.workDepth),
    stem: target.stem,
  };
  const companionOptions = { profile, ...(options.imageUrl && { imageUrl: options.imageUrl }) };

  if (state.status === 'in-place') {
    // The video is where the profile wants it: all that can be missing is what goes beside it
    // (a library organized before the profile wrote NFO and images, or by another profile).
    // Whatever is already there is left out rather than reported as skipped, or every rescan of
    // an organized library would be full of it.
    const missing = await Promise.all(
      companionOperations(input, place, companionOptions).map(async (operation) =>
        (await lstat(operation.destination).catch(() => null)) ? null : operation,
      ),
    );
    const operations = missing.filter((operation) => operation !== null);
    return operations.length > 0
      ? { ...base, operations, status: 'ready', conflicts: [] }
      : { ...base, status: 'in-place', conflicts: [] };
  }

  const sidecars = await findSidecars(
    source,
    options.sidecarExtensions ?? DEFAULT_SIDECAR_EXTENSIONS,
  );
  const operations: Operation[] = [
    { type: 'transfer', mode, role: 'main', source, destination },
    ...sidecars.map((sidecar): Operation => ({
      type: 'transfer',
      mode,
      role: 'sidecar',
      source: sidecar.path,
      destination: join(root, ...target.folders, `${target.stem}${sidecar.suffix}`),
    })),
  ];
  // A `.nfo` the user already had follows the video as a sidecar: it wins over a generated one
  // (the destination is the same, and nothing is overwritten).
  const taken = new Set(operations.map((operation) => operation.destination.toLowerCase()));
  operations.push(
    ...companionOperations(input, place, companionOptions).filter(
      (operation) => !taken.has(operation.destination.toLowerCase()),
    ),
  );
  return { ...base, operations, status: 'ready', conflicts: [] };
}

/**
 * Files about a whole show (`tvshow.nfo`, its poster) come with each of its episodes: only the
 * first item to ask for one keeps it. Case-insensitive, like the destination check.
 */
function shareCompanions(items: readonly PlanItem[]): PlanItem[] {
  const claimed = new Set<string>();
  return items.map((item) => {
    if (item.status !== 'ready') {
      return item;
    }
    const operations = item.operations.filter((operation) => {
      if (operation.type === 'transfer') {
        return true;
      }
      const key = operation.destination.toLowerCase();
      return !claimed.has(key) && !!claimed.add(key);
    });
    if (operations.length === 0) {
      // Everything it wanted was already claimed by an earlier episode of the show: only an item
      // that never had a transfer gets here, and it has nothing left to do.
      return { ...item, status: 'in-place', operations };
    }
    return operations.length === item.operations.length ? item : { ...item, operations };
  });
}

/**
 * Builds the plan for a batch of matched files. It reads the disk (existing destinations,
 * sidecars, devices) but never writes. Items sharing a destination are all held back.
 */
export async function createPlan(
  inputs: readonly PlanInput[],
  options: PlannerOptions,
): Promise<Plan> {
  const { profile } = options;

  const newId = options.newId ?? randomUUID;
  const items = await Promise.all(inputs.map((input) => planItem(input, options, newId())));

  // Case-insensitive: libraries are often shared with systems that cannot tell the names apart.
  const byDestination = new Map<string, PlanItem[]>();
  for (const item of items) {
    const main = item.operations[0];
    // An item with only companion files has no main transfer: nothing to collide on.
    if (item.status === 'ready' && main?.type === 'transfer') {
      const key = main.destination.toLowerCase();
      byDestination.set(key, [...(byDestination.get(key) ?? []), item]);
    }
  }
  const duplicated = new Set(
    [...byDestination.values()].filter((group) => group.length > 1).flat(),
  );

  return {
    id: newId(),
    createdAt: (options.now?.() ?? new Date()).toISOString(),
    profileId: profile.id,
    destinationRoot:
      typeof options.destinationRoot === 'string'
        ? resolve(options.destinationRoot)
        : {
            movie: resolve(options.destinationRoot.movie),
            series: resolve(options.destinationRoot.series),
          },
    mode: options.mode,
    items: shareCompanions(
      items.map((item): PlanItem => {
        const main = item.operations[0];
        return duplicated.has(item) && main && 'destination' in main
          ? {
              ...item,
              status: 'conflict',
              conflicts: [{ reason: 'duplicate-destination', path: main.destination }],
            }
          : item;
      }),
    ),
  };
}
