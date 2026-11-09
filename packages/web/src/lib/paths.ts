/** The last segment of a path: the file name, or the folder's own name. */
export const baseName = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;

/** Strictly inside `source`: a folder is not inside itself. */
/** The folder holding a file: what several versions of a movie share. */
export const dirName = (path: string): string => {
  const cut = path.lastIndexOf('/');
  return cut > 0 ? path.slice(0, cut) : path;
};

export function isBelow(path: string, source: string): boolean {
  const root = trimEnd(source);
  return path.startsWith(root === '/' ? '/' : `${root}/`) && path !== root;
}

const trimEnd = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path);
const folderOf = (path: string): string => path.replace(/\/[^/]*$/, '') || '/';

/**
 * What to read again for these files of a library: the folder that holds them all, as long as it
 * is inside the source (the source itself would be a scan of the whole library). A single file
 * lying directly in the source is read alone. `undefined` when nothing narrower can be told.
 */
export function rescanPath(files: readonly string[], source: string): string | undefined {
  const root = trimEnd(source);
  const [first, ...others] = files.map(folderOf);
  if (first === undefined) {
    return undefined;
  }
  let common = first.split('/');
  for (const folder of others) {
    const parts = folder.split('/');
    const length = common.findIndex((part, index) => parts[index] !== part);
    common =
      length === -1
        ? common.slice(0, Math.min(common.length, parts.length))
        : common.slice(0, length);
  }
  const folder = common.join('/') || '/';
  if (folder === root) {
    return files.length === 1 ? files[0] : undefined;
  }
  return isBelow(folder, root) ? folder : undefined;
}
