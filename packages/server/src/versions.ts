/** What a file says of the episodes it holds and of its version, as the snapshot keeps it. */
export interface VersionRow {
  readonly season: number | null;
  readonly episode: number | null;
  readonly episodeEnd: number | null;
  /** The picture size read in the name (`1080p`); `null` when it says none. */
  readonly resolution: string | null;
}

/** How much of a set of episodes one version holds. */
export interface VersionCoverage {
  readonly resolution: string | null;
  readonly covered: number;
  readonly total: number;
}

const key = (season: number, episode: number): string => `${String(season)}:${String(episode)}`;

/** The episodes a file holds: a range holds each of its numbers. */
function episodesOfRow(row: VersionRow): string[] {
  if (row.season === null || row.episode === null) {
    return [];
  }
  const last = row.episodeEnd ?? row.episode;
  return Array.from({ length: Math.max(last - row.episode + 1, 1) }, (_, offset) =>
    key(row.season ?? 0, (row.episode ?? 0) + offset),
  );
}

/** The distinct episodes a set of files holds: two versions of one episode are one. */
export function distinctEpisodes(rows: readonly VersionRow[]): number {
  return new Set(rows.flatMap(episodesOfRow)).size;
}

/**
 * The versions a set of files makes of its episodes, from the largest picture down. A file whose
 * name says no size is a version only beside another file of the same episode: alone it is no
 * version at all (nothing says it is not the others' sibling), and an episode held only that way
 * is left out of the totals, so one unlabelled file does not make every version look incomplete.
 */
export function versionsOf(rows: readonly VersionRow[]): (string | null)[] {
  const files = new Map<string, number>();
  for (const row of rows) {
    for (const episode of episodesOfRow(row)) {
      files.set(episode, (files.get(episode) ?? 0) + 1);
    }
  }
  const found = new Set<string | null>();
  for (const row of rows) {
    const shared = episodesOfRow(row).some((episode) => (files.get(episode) ?? 0) > 1);
    if (row.resolution !== null || shared) {
      found.add(row.resolution);
    }
  }
  return [...found].sort((a, b) => pixels(b) - pixels(a) || 0);
}

const pixels = (resolution: string | null): number =>
  resolution === null ? -1 : Number.parseInt(resolution, 10) || 0;

/** The files of one work from the largest picture down; the ones nothing tells apart keep their order. */
export const largestFirst = <T>(rows: readonly T[], resolution: (row: T) => string | null): T[] =>
  [...rows].sort((a, b) => pixels(resolution(b)) - pixels(resolution(a)));

/**
 * What each of `versions` holds of the episodes they hold together (`rows` may be a season of a
 * show: a version absent from it covers none of it). Empty when no file is a version.
 */
export function coverageOf(
  rows: readonly VersionRow[],
  versions: readonly (string | null)[] = versionsOf(rows),
): VersionCoverage[] {
  const held = new Set(
    rows.filter((row) => versions.includes(row.resolution)).flatMap(episodesOfRow),
  );
  return versions.map((resolution) => ({
    resolution,
    covered: new Set(rows.filter((row) => row.resolution === resolution).flatMap(episodesOfRow))
      .size,
    total: held.size,
  }));
}

/** The rows of each season, a file with no season being left out (it holds no episode). */
function bySeason(rows: readonly VersionRow[]): VersionRow[][] {
  const seasons = new Map<number, VersionRow[]>();
  for (const row of rows) {
    if (row.season !== null) seasons.set(row.season, [...(seasons.get(row.season) ?? []), row]);
  }
  return [...seasons.values()];
}

/**
 * A show's coverage, told season by season: a version is judged against the season that has it,
 * so a show released in 1080p one year and 720p the next lacks nothing. A version's tally is the
 * sum over the seasons where it is one.
 */
export function showCoverageOf(rows: readonly VersionRow[]): VersionCoverage[] {
  const sums = new Map<string | null, { covered: number; total: number }>();
  for (const season of bySeason(rows)) {
    for (const { resolution, covered, total } of coverageOf(season)) {
      const sum = sums.get(resolution) ?? { covered: 0, total: 0 };
      sums.set(resolution, { covered: sum.covered + covered, total: sum.total + total });
    }
  }
  return [...sums]
    .map(([resolution, sum]) => ({ resolution, ...sum }))
    .sort((a, b) => pixels(b.resolution) - pixels(a.resolution));
}

/** An episode held by more than one file. */
export function hasSeveralVersions(rows: readonly VersionRow[]): boolean {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const episode of episodesOfRow(row)) {
      if (seen.has(episode)) {
        return true;
      }
      seen.add(episode);
    }
  }
  return false;
}

/** Within one season, some version lacks an episode another one holds. */
export function hasIncompleteVersion(rows: readonly VersionRow[]): boolean {
  return bySeason(rows).some((season) =>
    coverageOf(season).some(({ covered, total }) => covered < total),
  );
}
