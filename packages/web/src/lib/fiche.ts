import type { Translate } from '@kinoshelf/i18n';
import { formatBytes } from '@kinoshelf/i18n';
import type { Version } from './library-items.js';
import { totalSize, type SlotStatus } from './versions.js';

// What the three sheets (movie, show, episode) say the same way: the line under the title, the
// summary of the Versions section, and the state of one version.

/** `151 min · Drame, Science-fiction`: the length, then the genres. */
export const movieMeta = (
  runtime: number | null,
  genres: readonly string[],
  t: Translate,
): string =>
  [runtime ? t('web.library.runtime', { minutes: runtime }) : undefined, genres.join(', ')]
    .filter(Boolean)
    .join(' · ');

/** `1 saison · 5 épisodes · Drame`: counts agreed by the catalog, then the genres. */
export const showMeta = (
  seasons: number,
  episodes: number,
  genres: readonly string[],
  t: Translate,
): string =>
  [
    t('web.library.meta.seasons', { count: seasons }),
    t('web.library.meta.episodes', { count: episodes }),
    genres.join(', '),
  ]
    .filter(Boolean)
    .join(' · ');

/**
 * `23 sept. 2021` in French, `Sep 23, 2021` in English: the date is the provider's calendar day,
 * so it is read and written in UTC (a time zone west of Greenwich would show the day before).
 * Anything that is not `YYYY-MM-DD` is dropped rather than shown raw.
 */
export function formatDay(day: string | null, locale: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '');
  if (match === null) {
    return undefined;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return undefined;
  }
}

/** `23 sept. 2021 · 68 min`: the air date, then the length. */
export const episodeMeta = (
  airDate: string | null,
  runtime: number | null,
  locale: string,
  t: Translate,
): string =>
  [formatDay(airDate, locale), runtime ? t('web.library.runtime', { minutes: runtime }) : undefined]
    .filter(Boolean)
    .join(' · ');

/** The parts of the Versions header after its title: the count, and the size when it is known. */
export function versionsSummary(
  versions: readonly Pick<Version, 'file'>[],
  locale: string,
  { withSize = true }: { withSize?: boolean } = {},
): string[] {
  const size = withSize ? totalSize(versions.map(({ file }) => file)) : null;
  return [String(versions.length), ...(size === null ? [] : [formatBytes(size, locale)])];
}

/** A version's badge: its own NFO is there or not (`null`, a profile that writes none, is whole). */
export const versionStatus = (version: Pick<Version, 'nfo'>): Exclude<SlotStatus, 'absent'> =>
  version.nfo === false ? 'nfo-missing' : 'complete';

/** `25 sur 30`, or the bare number when the total is not known. */
export const missingOfKnown = (missing: number, known: number | null, t: Translate): string =>
  known === null ? String(missing) : t('web.library.show.missing.of', { missing, known });
