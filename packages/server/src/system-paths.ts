import { resolve } from 'node:path';
import { isInside } from './notify/paths.js';

/** What the kernel shows as files: reading it as a library hangs on endless or blocking files. */
const SYSTEM_ROOTS = ['/proc', '/sys', '/dev'];

/**
 * The root of the disk or a kernel folder: never a library nor something to analyze. A request
 * naming one is a mistake or an attempt to make the server read what is not media.
 */
export function isSystemPath(path: string): boolean {
  const absolute = resolve(path);
  return absolute === '/' || SYSTEM_ROOTS.some((root) => isInside(absolute, root));
}

/** One folder is, or is inside, the other: reading one while the other changes is reading a moving target. */
export const sharesFolder = (a: string, b: string): boolean =>
  isInside(resolve(a), resolve(b)) || isInside(resolve(b), resolve(a));
