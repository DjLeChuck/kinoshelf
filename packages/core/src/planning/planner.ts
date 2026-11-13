import { randomUUID } from 'node:crypto';
import { lstat, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { KinoshelfError } from '../errors.js';
import { exists, nearestExistingDevice } from '../execution/fs-ops.js';
import { VIDEO_EXTENSIONS } from '../pipeline/discover.js';
import {
  parseTemplate,
  renderProfileTemplate,
  type TemplateVariables,
} from '../profiles/template.js';
import type { CollectionOverride } from '../collections.js';
import type { Details, ImageSize } from '../types/details.js';
import type { ErrorInfo } from '../types/errors.js';
import type { ParsedMedia } from '../types/media.js';
import type { Operation, TransferMode } from '../types/operation.js';
import type { Conflict, DestinationRoots, Plan, PlanItem } from '../types/plan.js';
import type { Profile } from '../types/profile.js';
import type { Candidate, EpisodeInfo } from '../types/provider.js';
import { companionOperations, unavailableImages } from './companions.js';
import { DEFAULT_SIDECAR_EXTENSIONS, findSidecars } from './sidecars.js';
import { MAX_VERSION_LEVEL, versionLabel, versionLabels } from './version.js';

/** A matched file, ready to be planned. `parsed.path` is the source file. */
export interface PlanInput {
  readonly parsed: ParsedMedia;
  readonly candidate: Candidate;
  /**
   * What an NFO and the images are made of. Only read when the profile writes any; without it
   * the file is still renamed, just with nothing beside it.
   */
  readonly details?: Details;
  /** The owner's choice of collection for a movie, over the one the details name. */
  readonly collectionOverride?: CollectionOverride;
  /** The provider's record of the file's episodes (also where `{episodeTitle}` comes from). */
  readonly episodes?: readonly EpisodeInfo[];
  /**
   * Name a movie with its version even though it is already in its folder under the profile's
   * name: the owner asked for it. Without a size in the name, or a profile that has no naming for
   * versions, the item is held back as unresolvable rather than guessed.
   */
  readonly applyVersion?: boolean;
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
  /**
   * Reads a video's picture size (`2160p`) from the file itself, for one whose name says none.
   * Asked only when it matters: the movie or episode already has another file under its name, or
   * the file collides with one. Absent, or `undefined` as an answer, the file stays unlabelled.
   */
  readonly sizeOf?: (path: string) => Promise<string | undefined>;
  /**
   * Whether a file is one Kinoshelf wrote and nobody touched since (`Journal.madeFileIdentity`).
   * An NFO that is one does not follow its video to a new name when the plan writes the NFO of
   * its new place: it says what the work was, and the video may now be another. Absent, every
   * NFO beside a video follows it.
   */
  readonly madeByUs?: (path: string) => Promise<boolean>;
  /**
   * The work of these files was corrected: in a folder where the video is already in place, the
   * NFO and images Kinoshelf wrote (`madeByUs`) are planned again as replacements, since they
   * describe the former work. Anything else already there (a file of the user's) is left alone.
   * Needs `madeByUs`.
   */
  readonly replaces?: boolean;
}

/** `unavailable` of a plan item, left out when there is none; what is already on the disk is not. */
async function unavailableKinds(
  input: Parameters<typeof companionOperations>[0],
  place: Parameters<typeof companionOperations>[1],
  options: Parameters<typeof companionOperations>[2],
): Promise<Pick<PlanItem, 'unavailable'>> {
  const lacking = unavailableImages(input, place, options);
  const kinds = (
    await Promise.all(
      lacking.map(async ({ kind, destination }) => ((await exists(destination)) ? [] : [kind])),
    )
  ).flat();
  return kinds.length > 0 ? { unavailable: kinds } : {};
}

const blocked = (conflict: Conflict, base: Omit<PlanItem, 'status' | 'conflicts'>): PlanItem => ({
  ...base,
  status: 'conflict',
  conflicts: [conflict],
});

/** The profile's naming of a second quality for this kind of work, if it has one. */
const versionTemplateOf = (profile: Profile, kind: 'movie' | 'series'): string | undefined =>
  kind === 'movie' ? profile.templates.movieVersion : profile.templates.episodeVersion;

/** The text of the version template that comes before `{version}`: what a labelled name shows. */
function versionPrefixOf(template: string): string {
  const first = parseTemplate(template).tokens[0];
  return first?.kind === 'text' ? first.text : '';
}

/**
 * Room left after the stem for what follows it: the video's extension, and also a sidecar's
 * suffix (`.en.forced.srt`) or `.nfo`, which share the stem. A stem cut to fit the extension
 * alone would push those past the filesystem's limit, or cut `.nfo` to `.nf`.
 */
const STEM_SUFFIX_RESERVE_BYTES = 32;

/** Target path segments (folders then file stem) for a matched file. */
function targetSegments(
  input: PlanInput,
  profile: Profile,
  extensionBytes: number,
  version?: string,
): { folders: string[]; stem: string; workDepth: number } {
  const { parsed, candidate } = input;
  // The provider's title for the (first) episode, else what the file name says.
  const episodeTitle = input.episodes?.find((e) => e.title)?.title ?? parsed.episodeTitle;
  const variables: TemplateVariables = {
    title: candidate.title,
    year: candidate.year,
    tmdb: candidate.id.id,
    ...(parsed.season !== undefined && { season: parsed.season }),
    ...(parsed.episodes.length > 0 && { episode: parsed.episodes }),
    ...(episodeTitle !== undefined && { episodeTitle }),
  };
  const render = (template: string, reserveBytes = 0): string[] =>
    renderProfileTemplate(profile, template, variables, reserveBytes);
  const { templates } = profile;

  // A rendered segment loses its leading spaces, which ` - {version}` starts with: the suffix is
  // rendered behind a placeholder that is cut off again.
  const suffixOf = (template: string | undefined): string =>
    version !== undefined && template !== undefined
      ? renderProfileTemplate(profile, `_${template}`, { ...variables, version })
          .join('')
          .slice(1)
      : '';

  if (candidate.kind === 'movie') {
    const folders = render(templates.movieFolder);
    // The suffix's size is kept out of the title's, which is the part that gives way.
    const suffix = suffixOf(templates.movieVersion);
    return {
      folders,
      stem: `${render(templates.movieFile, extensionBytes + Buffer.byteLength(suffix)).join('')}${suffix}`,
      workDepth: folders.length,
    };
  }
  if (parsed.season === undefined || parsed.episodes.length === 0) {
    throw new KinoshelfError('plan.episode-numbers-missing');
  }
  const seriesFolders = render(templates.seriesFolder);
  const suffix = suffixOf(templates.episodeVersion);
  return {
    folders: [...seriesFolders, ...render(templates.seasonFolder)],
    stem: `${render(templates.episodeFile, extensionBytes + Buffer.byteLength(suffix)).join('')}${suffix}`,
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

async function sameSize(first: string, second: string): Promise<boolean> {
  const [a, b] = await Promise.all([stat(first).catch(() => null), stat(second).catch(() => null)]);
  return a !== null && b !== null && a.size === b.size;
}

/** What a version label starts with: a picture size (`2160p`, `1080i`, `4K`). */
const SIZE_AT_START = /^(\d{3,4}[pi]|4k|uhd)(?![a-z0-9])/i;

/** Items for which a size read from the file would settle a name (see `PlannerOptions.sizeOf`). */
const wantingSize = new WeakSet<PlanItem>();

/** Whether the folder already holds another video of this work: bare, or under a version label. */
async function hasSibling(
  folder: string,
  stem: string,
  prefix: string,
  except: string,
): Promise<boolean> {
  const names = await readdir(folder).catch(() => []);
  return names.some((name) => {
    const found = extname(name);
    const other = basename(name, found);
    return (
      name !== basename(except) &&
      VIDEO_EXTENSIONS.includes(found.slice(1).toLowerCase()) &&
      (other === stem || (other.startsWith(`${stem}${prefix}`) && other.length > stem.length))
    );
  });
}

/**
 * Whether another video of the same work sits beside this stem (bare or labelled). For a caller
 * that wants to know if a plan made earlier may be stale: it cannot tell the profile's labels, so
 * it errs on the side of saying yes, which only costs a plan made again.
 */
export function hasVersionSibling(folder: string, stem: string, except: string): Promise<boolean> {
  return hasSibling(folder, stem, '', except);
}

async function planItem(
  input: PlanInput,
  options: PlannerOptions,
  id: string,
  listings: Map<string, Promise<string[]>>,
  versionLevel?: number,
): Promise<PlanItem> {
  const kind = input.candidate.kind;
  const versionTemplate = versionTemplateOf(options.profile, kind);
  const forced = input.applyVersion === true;
  if (forced && versionLevel === undefined) {
    return blocked(
      {
        reason: 'unresolvable-name',
        path: resolve(input.parsed.path),
        detail: { code: 'plan.version-unavailable' },
      },
      {
        id,
        parsed: input.parsed,
        externalId: input.candidate.id,
        operations: [],
      },
    );
  }
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
  const reserveBytes = Math.max(Buffer.byteLength(extension), STEM_SUFFIX_RESERVE_BYTES);
  try {
    target = targetSegments(input, profile, reserveBytes);
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
  const pathOf = (t: { folders: string[]; stem: string }): string =>
    join(root, ...t.folders, `${t.stem}${extension}`);
  let destination = pathOf(target);
  if (!destination.startsWith(`${root}${sep}`)) {
    return unresolvable({ code: 'plan.outside-root' });
  }

  let state = await classify(source, destination, mode);
  const prefix = versionTemplate === undefined ? '' : versionPrefixOf(versionTemplate);
  if (versionTemplate !== undefined) {
    // A file already in the work's folder under the profile's name, with or without a version
    // after it, is where it belongs: a library is never renamed behind its owner's back. A movie
    // may carry anything after a separator (`[1080p]`); an episode only the profile's own version
    // text, since a title after `S01E01` is something the profile does rename.
    const sourceStem = basename(source, extension);
    const rest = sourceStem.slice(target.stem.length);
    const labelled =
      kind === 'movie'
        ? rest === '' || /^[\s._[(-]/.test(rest)
        : rest === '' ||
          (rest.startsWith(prefix) &&
            rest.length > prefix.length &&
            // ` - The Emperor's Peace` is a title, ` - 2160p` a version, and so is anything else
            // when the bare name is another file's: this one is the work's second.
            (SIZE_AT_START.test(rest.slice(prefix.length)) ||
              ('conflict' in state && state.conflict.reason === 'destination-exists')));
    if (
      !forced &&
      dirname(source) === dirname(destination) &&
      sourceStem.startsWith(target.stem) &&
      labelled
    ) {
      target = { ...target, stem: sourceStem };
      destination = source;
      state = { status: 'in-place' };
    } else if (versionLevel !== undefined) {
      // The shortest label that is free: a file of the same size already there asks for the
      // source, then the group, before it is called a conflict.
      for (let level = versionLevel; level <= MAX_VERSION_LEVEL; level++) {
        const label = versionLabel(input.parsed, level);
        if (label === undefined) {
          break;
        }
        try {
          target = targetSegments(input, profile, reserveBytes, label);
        } catch (error) {
          if (error instanceof KinoshelfError) {
            return unresolvable(error.info);
          }
          throw error;
        }
        destination = pathOf(target);
        state = await classify(source, destination, mode);
        if (
          !('conflict' in state && state.conflict.reason === 'destination-exists') ||
          // The same size is most likely the same release again, not another version of it.
          (await sameSize(source, destination))
        ) {
          break;
        }
      }
    }
  }
  // Nothing in the name says its size, but the work already has another file beside where it would
  // go: reading the size from the file would let both be told apart.
  const needsSize =
    options.sizeOf !== undefined &&
    versionLevel === undefined &&
    versionTemplate !== undefined &&
    !forced &&
    (('conflict' in state && state.conflict.reason === 'destination-exists') ||
      ('status' in state &&
        state.status === 'ready' &&
        (await hasSibling(dirname(destination), target.stem, prefix, source))));
  if ('conflict' in state) {
    const item = blocked(state.conflict, base);
    if (needsSize) {
      wantingSize.add(item);
    }
    return item;
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
      companionOperations(input, place, companionOptions).map(
        async (operation): Promise<Operation | null> => {
          if (!(await exists(operation.destination))) {
            return operation;
          }
          return options.replaces === true &&
            operation.type !== 'transfer' &&
            (await options.madeByUs?.(operation.destination)) === true
            ? { ...operation, replace: true }
            : null;
        },
      ),
    );
    const operations = missing.filter((operation) => operation !== null);
    const unavailable = await unavailableKinds(input, place, companionOptions);
    return operations.length > 0
      ? { ...base, ...unavailable, operations, status: 'ready', conflicts: [] }
      : { ...base, ...unavailable, status: 'in-place', conflicts: [] };
  }

  const generated = companionOperations(input, place, companionOptions);
  // The profile writes this item's NFO, so Kinoshelf's is the one players read: a `.nfo` beside the
  // video (another tool's, or one edited by hand) stays where it is, never deleted, never overwritten.
  // Without one (`metadata: none`, a movie written flat) the file is all that is left of what it
  // said, and goes along with the video as before.
  const writesNfo = generated.some(
    (operation) => operation.type === 'write-file' && operation.destination.endsWith('.nfo'),
  );
  const sidecars = (
    await findSidecars(source, options.sidecarExtensions ?? DEFAULT_SIDECAR_EXTENSIONS, listings)
  ).filter((sidecar) => !(writesNfo && sidecar.suffix.toLowerCase().endsWith('.nfo')));
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
  // A sidecar that stays on its destination (a subtitle already there) is not written over.
  const taken = new Set(operations.map((operation) => operation.destination.toLowerCase()));
  operations.push(
    ...generated.filter((operation) => !taken.has(operation.destination.toLowerCase())),
  );
  const item: PlanItem = {
    ...base,
    ...(await unavailableKinds(input, place, companionOptions)),
    operations,
    status: 'ready',
    conflicts: [],
  };
  if (needsSize) {
    wantingSize.add(item);
  }
  return item;
}

/**
 * Files about a whole show (`tvshow.nfo`, its poster) come with each of its episodes: only the
 * first item to ask for one keeps it. Case-insensitive, like the destination check.
 */
/**
 * The items to run when only some of a plan's are chosen. `shareCompanions` gave a show's own
 * files (and a season's poster) to the first episode wanting them; when that episode is left out,
 * they go to the first chosen one whose video lies in the same folder, so a partial selection still
 * writes them. One that nobody chosen lives under stays out: it is not this selection's to write.
 */
export function selectItems(items: readonly PlanItem[], chosen: ReadonlySet<string>): PlanItem[] {
  const picked = items.filter((item) => chosen.has(item.id));
  const held = new Set(
    picked.flatMap((item) => item.operations.map((op) => op.destination.toLowerCase())),
  );
  const adopted = new Map<string, Operation[]>();
  for (const item of items) {
    if (chosen.has(item.id) || item.status !== 'ready') {
      continue;
    }
    for (const operation of item.operations) {
      const key = operation.destination.toLowerCase();
      if (operation.type === 'transfer' || operation.shared !== true || held.has(key)) {
        continue;
      }
      const folder = dirname(operation.destination);
      const heir = picked.find(
        (candidate) => candidate.status === 'ready' && isInside(videoOf(candidate), folder),
      );
      if (heir) {
        held.add(key);
        adopted.set(heir.id, [...(adopted.get(heir.id) ?? []), operation]);
      }
    }
  }
  return picked.map((item) => {
    const extra = adopted.get(item.id);
    return extra ? { ...item, operations: [...item.operations, ...extra] } : item;
  });
}

/** Where an item's video ends up: its transfer's destination, or where it already is. */
function videoOf(item: PlanItem): string {
  const main = item.operations.find((op) => op.type === 'transfer' && op.role === 'main');
  return main?.destination ?? item.parsed.path;
}

function isInside(path: string, folder: string): boolean {
  const rest = relative(folder, path);
  return rest !== '' && !rest.startsWith('..') && !isAbsolute(rest);
}

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
 * How much of its quality each file's name says (see `versionLabel`), for a profile that keeps
 * several qualities of a movie or an episode in one folder. The files of one work in the batch are
 * told apart together, so the result does not depend on their order. `undefined`: no suffix (no
 * such profile, or a file that never says its size).
 */
/** One work for a movie, one episode (or double episode) of a show for a series. */
function workKeyOf(input: PlanInput): string {
  const { id } = input.candidate;
  const episode =
    input.candidate.kind === 'movie'
      ? ''
      : `:${String(input.parsed.season)}:${input.parsed.episodes.join(',')}`;
  return `${id.provider}:${String(id.id)}${episode}`;
}

function versionLevels(inputs: readonly PlanInput[], profile: Profile): (number | undefined)[] {
  const levels: (number | undefined)[] = inputs.map(() => undefined);
  const groups = new Map<string, number[]>();
  inputs.forEach((input, index) => {
    if (
      versionTemplateOf(profile, input.candidate.kind) !== undefined &&
      input.parsed.screenSize !== undefined
    ) {
      const key = workKeyOf(input);
      groups.set(key, [...(groups.get(key) ?? []), index]);
    }
  });
  for (const members of groups.values()) {
    const files = members.map((index) => (inputs[index] as PlanInput).parsed);
    const labels = versionLabels(files);
    members.forEach((index, position) => {
      const file = files[position] as ParsedMedia;
      const label = labels[position];
      // Files nothing can tell apart all take the finest label: the batch then reports them.
      let level = MAX_VERSION_LEVEL;
      for (let candidate = 0; label !== null && candidate <= MAX_VERSION_LEVEL; candidate++) {
        if (versionLabel(file, candidate) === label) {
          level = candidate;
          break;
        }
      }
      levels[index] = level;
    });
  }
  return levels;
}

/** Items looked at on the disk at once: a library of thousands must not open them all together. */
const ITEMS_AT_ONCE = 32;

async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(
      ...(await Promise.all(
        items.slice(start, start + size).map((item, i) => task(item, start + i)),
      )),
    );
  }
  return results;
}

/** Files read at once for their size: ffprobe is a process each. */
const SIZES_AT_ONCE = 4;

/** The items of a batch, with the duplicates held back, and which of them want a size read. */
async function buildItems(
  inputs: readonly PlanInput[],
  options: PlannerOptions,
  ids: readonly string[],
): Promise<{ items: PlanItem[]; wanting: boolean[] }> {
  const listings = new Map<string, Promise<string[]>>();
  const levels = versionLevels(inputs, options.profile);
  const planned = await inBatches(inputs, ITEMS_AT_ONCE, (input, index) =>
    planItem(input, options, ids[index] as string, listings, levels[index]),
  );

  // Case-insensitive: libraries are often shared with systems that cannot tell the names apart.
  const byDestination = new Map<string, PlanItem[]>();
  for (const item of planned) {
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
  const items = planned.map((item): PlanItem => {
    const main = item.operations[0];
    return duplicated.has(item) && main && 'destination' in main
      ? {
          ...item,
          status: 'conflict',
          conflicts: [{ reason: 'duplicate-destination', path: main.destination }],
        }
      : item;
  });
  // Two files of one work in the batch, one of which says nothing of its size, are versions of
  // each other: reading it is what tells them apart (and two that say nothing collide anyway).
  const perWork = new Map<string, number>();
  for (const input of inputs) {
    perWork.set(workKeyOf(input), (perWork.get(workKeyOf(input)) ?? 0) + 1);
  }
  const wanting = planned.map((item, index) => {
    const input = inputs[index] as PlanInput;
    return (
      (wantingSize.has(item) || duplicated.has(item) || (perWork.get(workKeyOf(input)) ?? 0) > 1) &&
      input.parsed.screenSize === undefined &&
      versionTemplateOf(options.profile, input.candidate.kind) !== undefined
    );
  });
  return { items, wanting };
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
  // Ids are drawn in input order whatever the order the disk answers in.
  const ids = inputs.map(() => newId());
  let used = inputs;
  let built = await buildItems(used, options, ids);
  if (options.sizeOf) {
    // A file whose name says no size but whose place is taken is read once, and the batch planned
    // again with what was found, so every file of the work is told apart together.
    const wanting = built.wanting.flatMap((wants, index) => (wants ? [index] : []));
    const sizes = new Map<number, string>();
    for (let start = 0; start < wanting.length; start += SIZES_AT_ONCE) {
      await Promise.all(
        wanting.slice(start, start + SIZES_AT_ONCE).map(async (index) => {
          const size = await options.sizeOf?.(resolve((used[index] as PlanInput).parsed.path));
          if (size !== undefined) {
            sizes.set(index, size);
          }
        }),
      );
    }
    if (sizes.size > 0) {
      used = used.map((input, index) => {
        const size = sizes.get(index);
        return size === undefined
          ? input
          : { ...input, parsed: { ...input.parsed, screenSize: size } };
      });
      built = await buildItems(used, options, ids);
    }
  }
  const { items } = built;

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
    items: shareCompanions(items),
  };
}
