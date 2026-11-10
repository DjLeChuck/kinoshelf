import type { ReportOperation, RunReport } from './library-items.js';

/** One file of the preview: its name, and the same name without what its folder already says. */
export interface PreviewFile {
  readonly operation: ReportOperation;
  readonly name: string;
  /** `… - 2160p.mkv` when the name starts with its folder's (Jellyfin requires it), else the name. */
  readonly short: string;
}

/** What goes into one folder: the files that travel (the video, its companions), then the ones written. */
export interface PreviewFolder {
  /** Relative to the preview's root, no trailing slash. */
  readonly path: string;
  readonly moved: readonly PreviewFile[];
  readonly written: readonly PreviewFile[];
}

export interface PreviewItem {
  readonly entryId: string;
  readonly folders: readonly PreviewFolder[];
  readonly count: number;
  readonly failed: boolean;
}

export interface RunPreview {
  /** The folder every destination shares, with a trailing slash: shown once. */
  readonly root: string;
  readonly items: readonly PreviewItem[];
}

const split = (path: string): string[] => path.split('/');
const folderOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf('/'), 0));

/**
 * The folder shared by every destination, stepping up once when it is itself a destination's folder
 * (one movie alone: its folder is what to show, not the root).
 */
function commonRoot(folders: readonly string[]): string[] {
  const [first, ...others] = folders.map(split);
  if (first === undefined) {
    return [];
  }
  let common = first;
  for (const parts of others) {
    const index = common.findIndex((part, at) => parts[at] !== part);
    common =
      index === -1
        ? common.slice(0, Math.min(common.length, parts.length))
        : common.slice(0, index);
  }
  const joined = common.join('/');
  return folders.includes(joined) && common.length > 1 ? common.slice(0, -1) : common;
}

function fileOf(operation: ReportOperation, folder: string): PreviewFile {
  const name = operation.destination.slice(folder.length + 1);
  const own = folder.slice(folder.lastIndexOf('/') + 1);
  const short =
    own !== '' && name.length > own.length && name.startsWith(own)
      ? `…${name.slice(own.length)}`
      : name;
  return { operation, name, short };
}

/** Groups a report by file, then by folder, so that what a folder holds is told once. */
export function previewOf(report: Pick<RunReport, 'items'>): RunPreview {
  const everyFolder = report.items.flatMap(({ results }) =>
    results.map((r) => folderOf(r.destination)),
  );
  const rootParts = commonRoot(everyFolder);
  const root = rootParts.length > 1 ? `${rootParts.join('/')}/` : '/';
  const cut = root.length - 1;

  const items = report.items.map(({ entryId, results }): PreviewItem => {
    const byFolder = new Map<string, ReportOperation[]>();
    for (const operation of results) {
      const folder = folderOf(operation.destination);
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), operation]);
    }
    const folders = [...byFolder].map(([folder, operations]): PreviewFolder => {
      const files = operations.map((operation) => fileOf(operation, folder));
      return {
        path: folder.slice(cut + 1),
        moved: files.filter(({ operation }) => operation.type === 'transfer'),
        written: files.filter(({ operation }) => operation.type !== 'transfer'),
      };
    });
    return {
      entryId,
      folders,
      count: results.length,
      failed: results.some(({ status }) => status === 'failed'),
    };
  });
  return { root, items };
}
