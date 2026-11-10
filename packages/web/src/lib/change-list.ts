import { baseName, dirName } from './paths.js';

/**
 * One line of a long list of changes (a rename preview, a batch's files, an undo preview). The
 * lists are read by a person scanning for what is wrong, so a row says whether it is a `problem`,
 * and the list shows those first.
 */
export interface ChangeRow {
  readonly id: string;
  /** Rows sharing a key fold under one line: the episodes of a show, the files of a movie. */
  readonly group: string;
  readonly groupLabel: string;
  /** `S01E02`: what tells the row apart inside its group. */
  readonly tag?: string;
  /** What the row is, when `before`/`after` are not enough (a movie's title, a written file). */
  readonly title?: string;
  /** A rename: the name it had, the name it gets. Left out when nothing is renamed. */
  readonly before?: string;
  readonly after?: string;
  /** The full paths, for the hover. */
  readonly beforeTitle?: string;
  readonly afterTitle?: string;
  readonly chips: readonly { readonly text: string; readonly tone: ChipTone }[];
  /** Why it is a problem, already translated. */
  readonly note?: string;
  /** Needs a look: blocked, failed, left in place. */
  readonly problem: boolean;
  /** Files that come with the row and are not listed in it (the companions and the written ones). */
  readonly detailCount: number;
}

export type ChipTone = 'ok' | 'warn' | 'danger' | 'neutral';

export type Scope = 'problems' | 'all';

export interface RowGroup {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly ChangeRow[];
  readonly problems: number;
}

/** How many groups (then how many rows of a group) show before "Show more". */
export const PAGE_SIZE = 50;

/** A comparison that ignores case and accents: `elevation` finds `Élévation`. */
const plain = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export function matches(row: ChangeRow, query: string): boolean {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return true;
  }
  const text = plain(
    [row.groupLabel, row.tag, row.title, row.before, row.after].filter(Boolean).join(' '),
  );
  return words.every((word) => text.includes(word));
}

/**
 * The rows kept by a search, then folded by group. Groups holding a problem come first, in the
 * order they came otherwise. With the `problems` scope a group keeps only its problem rows: a
 * show with one blocked episode among thirty lists that one.
 */
export function groupRows(rows: readonly ChangeRow[], scope: Scope, query: string): RowGroup[] {
  const groups = new Map<string, { label: string; rows: ChangeRow[] }>();
  for (const row of rows) {
    if (!matches(row, query)) {
      continue;
    }
    const group = groups.get(row.group) ?? { label: row.groupLabel, rows: [] };
    group.rows.push(row);
    groups.set(row.group, group);
  }
  const built = [...groups].map(([key, { label, rows: kept }]): RowGroup => {
    const problems = kept.filter(({ problem }) => problem).length;
    return {
      key,
      label,
      rows: scope === 'problems' ? kept.filter(({ problem }) => problem) : kept,
      problems,
    };
  });
  const listed = scope === 'problems' ? built.filter(({ problems }) => problems > 0) : built;
  // `sort` is stable: the order of arrival holds within each side.
  return listed.sort((a, b) => Number(b.problems > 0) - Number(a.problems > 0));
}

/** What the scope tabs count: groups, so a show of thirty episodes is one. */
export function countGroups(rows: readonly ChangeRow[]): { all: number; problems: number } {
  const all = new Set<string>();
  const problems = new Set<string>();
  for (const row of rows) {
    all.add(row.group);
    if (row.problem) {
      problems.add(row.group);
    }
  }
  return { all: all.size, problems: problems.size };
}

const SEASON_FOLDER = /^(season \d+|specials)$/i;

/**
 * The work a file belongs to, from where it lies: a movie's folder, or a show's (its seasons'
 * files and its own, the NFO and the posters, share it). A file that moved nowhere is told by where
 * it came from.
 */
export function workOf(path: string): { key: string; name: string } {
  let folder = dirName(path);
  if (SEASON_FOLDER.test(baseName(folder))) {
    folder = dirName(folder);
  }
  return { key: folder, name: baseName(folder) };
}
