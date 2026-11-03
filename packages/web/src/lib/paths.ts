/** The last segment of a path: the file name, or the folder's own name. */
export const baseName = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;
