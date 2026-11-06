import type { ParsedMedia } from '../types/media.js';

/**
 * What tells two files of the same movie apart, from the coarsest to the finest: the picture
 * size, then where it comes from, then who released it. Each level adds to the one before.
 */
const LEVELS = ['screenSize', 'source', 'releaseGroup'] as const;

/** The finest level: past it nothing more can be said of a file. */
export const MAX_VERSION_LEVEL = LEVELS.length - 1;

/** The label of a file at a given level of detail; `undefined` when it has no picture size. */
export function versionLabel(parsed: ParsedMedia, level = 0): string | undefined {
  // Without a size there is nothing to say: a source or a group alone does not name a quality.
  if (parsed.screenSize === undefined) {
    return undefined;
  }
  const parts = LEVELS.slice(0, level + 1).flatMap((key) => parsed[key] ?? []);
  return parts.join(' ');
}

/**
 * Labels for the files of one movie that share a folder: the shortest label that is different for
 * every file. `undefined` for a file with no size; `null` when even the finest label leaves two
 * files alike, which the planner reports as a conflict rather than numbering them.
 */
export function versionLabels(files: readonly ParsedMedia[]): (string | undefined | null)[] {
  for (let level = 0; level < LEVELS.length; level++) {
    const labels = files.map((file) => versionLabel(file, level));
    const named = labels.filter((label) => label !== undefined);
    if (new Set(named).size === named.length) {
      return labels;
    }
  }
  const finest = files.map((file) => versionLabel(file, LEVELS.length - 1));
  return finest.map((label) =>
    label !== undefined && finest.indexOf(label) !== finest.lastIndexOf(label) ? null : label,
  );
}

const SIZE_STEPS = [
  { name: '2160p', width: 3400, height: 2000 },
  { name: '1440p', width: 2500, height: 1300 },
  { name: '1080p', width: 1800, height: 1000 },
  { name: '720p', width: 1200, height: 680 },
  { name: '576p', width: 700, height: 540 },
] as const;

/**
 * The picture size a video's frame is called by, as a release name would. The width counts as much
 * as the height: a 2.39:1 film in 1080p is 1920x800 (the bars are cut), a 4K one 3840x1600, and
 * both are told by the width. Whichever of the two reads the larger size wins.
 */
export function pictureSize(width: number, height: number): string {
  const step = (axis: 'width' | 'height', value: number): number => {
    const found = SIZE_STEPS.findIndex((candidate) => value >= candidate[axis]);
    return found === -1 ? SIZE_STEPS.length : found;
  };
  const index = Math.min(step('width', width), step('height', height));
  return SIZE_STEPS[index]?.name ?? '480p';
}
