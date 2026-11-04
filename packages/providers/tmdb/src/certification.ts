import type { Certification } from '@kinoshelf/core';

/** Languages whose country is not their own code upper-cased (`en` is no country). */
const COUNTRY_OF_LANGUAGE: Readonly<Record<string, string>> = {
  en: 'US',
  ja: 'JP',
  ko: 'KR',
  zh: 'CN',
  sv: 'SE',
  da: 'DK',
  cs: 'CZ',
  el: 'GR',
  he: 'IL',
  uk: 'UA',
};

/**
 * The country whose age rating suits a metadata language: its region when it has one (`en-GB`),
 * otherwise a guess from the language (`fr` gives `FR`); `US` when there is none, as TMDB's own
 * default is English.
 */
export function countryOf(language: string | undefined): string {
  if (!language) return 'US';
  const [code = '', region] = language.split('-');
  if (region) return region.toUpperCase();
  const lower = code.toLowerCase();
  return COUNTRY_OF_LANGUAGE[lower] ?? lower.toUpperCase();
}

export interface RatedIn {
  readonly country: string;
  /** Blank when the country is listed without a rating, which TMDB does. */
  readonly value: string | null | undefined;
}

/** The rating of the language's country, else the American one, else the first there is. */
export function pickCertification(
  ratings: readonly RatedIn[],
  language: string | undefined,
): Certification | undefined {
  const rated = ratings.flatMap((r) => {
    const value = r.value?.trim();
    return value ? [{ country: r.country.toUpperCase(), value }] : [];
  });
  const wanted = countryOf(language);
  return (
    rated.find((r) => r.country === wanted) ?? rated.find((r) => r.country === 'US') ?? rated[0]
  );
}

/** TMDB release types: 3 is the theatrical release, whose rating is the one a player shows. */
const THEATRICAL = 3;

/** A movie's rating in one country: its theatrical release's when it has one, else any. */
export function movieRating(
  releases: readonly {
    certification?: string | null | undefined;
    type?: number | null | undefined;
  }[],
): string | undefined {
  const rated = releases.filter((r) => r.certification?.trim());
  return (rated.find((r) => r.type === THEATRICAL) ?? rated[0])?.certification?.trim();
}
