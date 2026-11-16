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
 * the journal's size and date must match. A sub-folder is held to the same rule (an
 * emptied `Subs` goes). Any other file, or a link, keeps the folder, so nothing the user put there is ever lost. Never leaves, or removes, a library root.
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

/**
 * Whether everything under `directory` can go: files Kinoshelf made and nobody changed, and
 * folders that are themselves like that (an empty one included: a release's `Subs` once its files
 * went along with the video). Collects what to delete, deepest folders first.
 */
async function removable(
  directory: string,
  journal: Journal,
  files: string[],
  directories: string[],
): Promise<boolean> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!(await removable(path, journal, files, directories))) {
        return false;
      }
    } else if (entry.isFile() && (await madeByUs(journal, path))) {
      files.push(path);
    } else {
      return false;
    }
  }
  directories.push(directory);
  return true;
}

async function removeIfOurs(directory: string, journal: Journal): Promise<boolean> {
  try {
    const files: string[] = [];
    const directories: string[] = [];
    if (!(await removable(directory, journal, files, directories))) {
      return false;
    }
    for (const path of files) {
      await unlink(path);
    }
    for (const path of directories) {
      await rmdir(path);
    }
    return true;
  } catch {
    return false;
  }
}
