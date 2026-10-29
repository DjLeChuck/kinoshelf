import { readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { ApiError } from './api-error.js';

export interface FolderEntry {
  readonly name: string;
  readonly kind: 'directory' | 'file';
}

export interface FolderListing {
  readonly path: string;
  /** `null` at the root. */
  readonly parent: string | null;
  readonly entries: readonly FolderEntry[];
  /** A folder with more entries than a picker can usefully show is cut. */
  readonly truncated: boolean;
}

/** What a picker asks for besides folders: the one kind of file a setting can name. */
export type FileFilter = 'yaml';

export const MAX_ENTRIES = 2000;

const matchers: Record<FileFilter, RegExp> = { yaml: /\.ya?ml$/i };

/**
 * What a folder of the server's disk holds, for a picker: sub-folders, and files of one kind only
 * when asked. Names only, never contents. Hidden entries are left out (a library does not live in
 * one), and a symlink shows as what it points to, or not at all when it is broken.
 */
export async function listFolder(
  requested: string,
  options: { files?: FileFilter } = {},
): Promise<FolderListing> {
  if (!isAbsolute(requested)) {
    throw new ApiError(400, 'fs.not-absolute');
  }
  const path = resolve(requested);

  try {
    if (!(await stat(path)).isDirectory()) {
      throw new ApiError(409, 'fs.not-a-directory', { path });
    }
  } catch (error) {
    throw asApiError(error, path);
  }

  let names;
  try {
    names = await readdir(path, { withFileTypes: true });
  } catch (error) {
    throw asApiError(error, path);
  }

  const wanted = options.files && matchers[options.files];
  const entries: FolderEntry[] = [];
  for (const dirent of names) {
    if (dirent.name.startsWith('.')) {
      continue;
    }
    let kind: FolderEntry['kind'] | undefined;
    if (dirent.isSymbolicLink()) {
      kind = await followed(join(path, dirent.name));
    } else if (dirent.isDirectory()) {
      kind = 'directory';
    } else if (dirent.isFile()) {
      kind = 'file';
    }
    if (kind === 'directory' || (kind === 'file' && wanted?.test(dirent.name))) {
      entries.push({ name: dirent.name, kind });
    }
  }

  // Folders first, then each group by name, as a file manager does.
  entries.sort(
    (a, b) =>
      Number(a.kind === 'file') - Number(b.kind === 'file') ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
  return {
    path,
    parent: dirname(path) === path ? null : dirname(path),
    entries: entries.slice(0, MAX_ENTRIES),
    truncated: entries.length > MAX_ENTRIES,
  };
}

async function followed(path: string): Promise<FolderEntry['kind'] | undefined> {
  try {
    const target = await stat(path);
    return target.isDirectory() ? 'directory' : target.isFile() ? 'file' : undefined;
  } catch {
    return undefined; // a broken link
  }
}

function asApiError(error: unknown, path: string): unknown {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new ApiError(404, 'fs.not-found', { path });
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new ApiError(403, 'fs.unreadable', { path });
  }
  return error;
}
