import { ApiError } from './api.js';

export interface FolderListing {
  readonly path: string;
  readonly parent: string | null;
  readonly entries: readonly { readonly name: string; readonly kind: 'directory' | 'file' }[];
  readonly truncated: boolean;
}

export type FileFilter = 'yaml';

type Get = <T>(url: string) => Promise<T>;

/** `/media/films` → `/media`; nothing above the root. */
export function parentOf(path: string): string | undefined {
  const trimmed = path.replace(/\/+$/, '');
  if (trimmed === '') {
    return undefined;
  }
  const cut = trimmed.lastIndexOf('/');
  return cut <= 0 ? '/' : trimmed.slice(0, cut);
}

/** `/media` + `films` → `/media/films`, whether or not the folder path ends with a slash. */
export const childOf = (folder: string, name: string): string =>
  `${folder.replace(/\/+$/, '')}/${name}`;

const SKIPPABLE = new Set(['fs.not-found', 'fs.not-a-directory', 'fs.unreadable']);

/**
 * Opens the picker where the typed value is: that folder, or the nearest ancestor that exists (a
 * destination not created yet, a profile file), or the root when the value is empty or not even a
 * path. Any other failure (no session, server down) is the caller's to show.
 */
export async function openAt(get: Get, typed: string, files?: FileFilter): Promise<FolderListing> {
  const filter = files ? `&files=${files}` : '';
  let candidate = typed.trim().startsWith('/') ? typed.trim() : '/';
  for (;;) {
    try {
      return await get<FolderListing>(`/api/fs?path=${encodeURIComponent(candidate)}${filter}`);
    } catch (error) {
      const parent = parentOf(candidate);
      if (!(error instanceof ApiError) || !SKIPPABLE.has(error.code) || parent === undefined) {
        throw error;
      }
      candidate = parent;
    }
  }
}
