import { readdir, rmdir, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { Journal } from '../types/journal.js';
import type { DestinationRoots } from '../types/plan.js';

function rootsOf(destinationRoot: DestinationRoots): string[] {
  return typeof destinationRoot === 'string'
    ? [destinationRoot]
    : [destinationRoot.movie, destinationRoot.series];
}

/** Strictly below a root: a root itself is a library, never ours to remove. */
function isInside(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    const rel = relative(root, path);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  });
}

/**
 * Cleans the folder a move left behind, and its parents while they follow. A folder goes only
 * when everything still in it is a file Kinoshelf made (NFO, artwork) and nobody touched since:
 * the journal's size and date must match. Any other file, any sub-folder or link, keeps the
 * folder, so nothing the user put there is ever lost. Never leaves, or removes, a library root.
 * Best effort: a failure here changes nothing for the transfer that came before.
 */
export async function pruneVacated(
  directories: readonly string[],
  destinationRoot: DestinationRoots,
  journal: Journal,
): Promise<void> {
  const roots = rootsOf(destinationRoot);
  const visited = new Set<string>();
  for (const start of directories) {
    for (let current = start; isInside(current, roots) && !visited.has(current);) {
      visited.add(current);
      if (!(await removeIfOurs(current, journal))) {
        break;
      }
      current = dirname(current);
    }
  }
}

/**
 * Whether `path` is a file Kinoshelf made and nobody changed since: the journal knows it, and its
 * size and date are what they were when written. Anything else (another file, one edited by hand
 * or by a player, one gone) is not ours to remove or to leave behind.
 */
export async function madeByUs(journal: Journal, path: string): Promise<boolean> {
  const made = journal.madeFileIdentity(path);
  if (!made) {
    return false;
  }
  try {
    const now = await stat(path);
    return now.isFile() && now.size === made.size && now.mtimeMs === made.mtimeMs;
  } catch {
    return false;
  }
}

async function removeIfOurs(directory: string, journal: Journal): Promise<boolean> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const ours: string[] = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (!entry.isFile() || !(await madeByUs(journal, path))) {
        return false;
      }
      ours.push(path);
    }
    for (const path of ours) {
      await unlink(path);
    }
    await rmdir(directory);
    return true;
  } catch {
    return false;
  }
}
