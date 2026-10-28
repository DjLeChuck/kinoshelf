import { randomUUID } from 'node:crypto';
import { lstat, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { KinoshelfError } from '../errors.js';
import { nearestExistingDevice } from '../execution/fs-ops.js';
import { parseTemplate, renderTemplate, type TemplateVariables } from '../profiles/template.js';
import type { ErrorInfo } from '../types/errors.js';
import type { ParsedMedia } from '../types/media.js';
import type { Operation, TransferMode } from '../types/operation.js';
import type { Conflict, Plan, PlanItem } from '../types/plan.js';
import type { Profile } from '../types/profile.js';
import type { Candidate } from '../types/provider.js';
import { DEFAULT_SIDECAR_EXTENSIONS, findSidecars } from './sidecars.js';

/** A matched file, ready to be planned. `parsed.path` is the source file. */
export interface PlanInput {
  readonly parsed: ParsedMedia;
  readonly candidate: Candidate;
  readonly episodeTitle?: string;
}

export interface PlannerOptions {
  readonly profile: Profile;
  readonly destinationRoot: string;
  readonly mode: TransferMode;
  readonly sidecarExtensions?: readonly string[];
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
): { folders: string[]; stem: string } {
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
    return {
      folders: render(templates.movieFolder),
      stem: render(templates.movieFile, extensionBytes).join(''),
    };
  }
  if (parsed.season === undefined || parsed.episodes.length === 0) {
    throw new KinoshelfError('plan.episode-numbers-missing');
  }
  return {
    folders: [...render(templates.seriesFolder), ...render(templates.seasonFolder)],
    stem: render(templates.episodeFile, extensionBytes).join(''),
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
  let target: { folders: string[]; stem: string };
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
  const root = resolve(options.destinationRoot);
  const destination = join(root, ...target.folders, `${target.stem}${extension}`);
  if (!destination.startsWith(`${root}${sep}`)) {
    return unresolvable({ code: 'plan.outside-root' });
  }

  const state = await classify(source, destination, mode);
  if ('conflict' in state) {
    return blocked(state.conflict, base);
  }
  if (state.status === 'in-place') {
    return { ...base, status: 'in-place', conflicts: [] };
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
  return { ...base, operations, status: 'ready', conflicts: [] };
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
  if (profile.nfo) {
    throw new KinoshelfError('plan.profile-feature-unsupported', { feature: 'nfo' });
  }
  if (profile.artwork.length > 0) {
    throw new KinoshelfError('plan.profile-feature-unsupported', { feature: 'artwork' });
  }

  const newId = options.newId ?? randomUUID;
  const items = await Promise.all(inputs.map((input) => planItem(input, options, newId())));

  // Case-insensitive: libraries are often shared with systems that cannot tell the names apart.
  const byDestination = new Map<string, PlanItem[]>();
  for (const item of items) {
    const main = item.operations[0];
    if (item.status === 'ready' && main && 'destination' in main) {
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
    destinationRoot: resolve(options.destinationRoot),
    mode: options.mode,
    items: items.map((item): PlanItem => {
      const main = item.operations[0];
      return duplicated.has(item) && main && 'destination' in main
        ? {
            ...item,
            status: 'conflict',
            conflicts: [{ reason: 'duplicate-destination', path: main.destination }],
          }
        : item;
    }),
  };
}
