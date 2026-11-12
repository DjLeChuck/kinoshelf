import { describe, expect, it } from 'vitest';
import { createTranslator } from '@kinoshelf/i18n';
import {
  episodeMeta,
  formatDay,
  missingOfKnown,
  movieMeta,
  showMeta,
  versionStatus,
  versionsSummary,
} from '../src/lib/fiche.js';
import type { ProbedFile } from '../src/lib/library-items.js';

const GIB = 1024 ** 3;
const file = (size: number): Pick<{ file: ProbedFile | null }, 'file'> => ({
  file: { video: null, audio: null, hdr: null, audioLanguages: [], subtitleLanguages: [], size },
});

describe.each([
  ['fr', createTranslator('fr')],
  ['en', createTranslator('en')],
] as const)('the line under the title (%s)', (locale, t) => {
  it('agrees the counts of a show, then the genres', () => {
    const one = showMeta(1, 5, ['Drame'], t);
    const many = showMeta(2, 1, [], t);
    if (locale === 'fr') {
      expect(one).toBe('1 saison · 5 épisodes · Drame');
      expect(many).toBe('2 saisons · 1 épisode');
    } else {
      expect(one).toBe('1 season · 5 episodes · Drame');
      expect(many).toBe('2 seasons · 1 episode');
    }
  });

  it('puts the length of a movie before its genres, and never a size or a count of versions', () => {
    expect(movieMeta(151, ['Drame', 'Science-fiction'], t)).toBe(
      '151 min · Drame, Science-fiction',
    );
    expect(movieMeta(null, ['Drame'], t)).toBe('Drame');
    expect(movieMeta(null, [], t)).toBe('');
  });

  it('puts the date of an episode before its length', () => {
    const line = episodeMeta('2021-09-23', 68, locale, t);
    expect(line).toBe(locale === 'fr' ? '23 sept. 2021 · 68 min' : 'Sep 23, 2021 · 68 min');
    expect(episodeMeta(null, 68, locale, t)).toBe('68 min');
  });
});

describe('formatDay', () => {
  it('writes the calendar day of the provider whatever the time zone', () => {
    expect(formatDay('2021-01-01', 'fr')).toBe('1 janv. 2021');
    expect(formatDay('2021-12-31', 'en')).toBe('Dec 31, 2021');
  });

  it('drops what is not a date rather than showing it raw', () => {
    expect(formatDay(null, 'fr')).toBeUndefined();
    expect(formatDay('2021-09-23T00:00:00Z', 'fr')).toBeUndefined();
    expect(formatDay('soon', 'en')).toBeUndefined();
  });
});

describe('versionsSummary', () => {
  it('gives the count, then the total size', () => {
    expect(versionsSummary([file(GIB), file(2 * GIB)], 'en')).toEqual(['2', '3.0 GiB']);
  });

  it('leaves the size out when no file was read yet, or when asked to', () => {
    expect(versionsSummary([{ file: null }, { file: null }], 'en')).toEqual(['2']);
    expect(versionsSummary([file(GIB)], 'en', { withSize: false })).toEqual(['1']);
  });

  it('counts only the files that were read in the size', () => {
    expect(versionsSummary([file(GIB), { file: null }], 'en')).toEqual(['2', '1.0 GiB']);
  });
});

describe('versionStatus', () => {
  it('is complete with its NFO, or when the profile writes none', () => {
    expect(versionStatus({ nfo: true })).toBe('complete');
    expect(versionStatus({ nfo: null })).toBe('complete');
  });

  it('lacks its NFO only when the file says so', () => {
    expect(versionStatus({ nfo: false })).toBe('nfo-missing');
  });
});

describe('missingOfKnown', () => {
  it('reads the missing episodes against the ones TMDB lists', () => {
    expect(missingOfKnown(25, 30, createTranslator('fr'))).toBe('25 sur 30');
    expect(missingOfKnown(25, 30, createTranslator('en'))).toBe('25 of 30');
  });

  it('is the bare number when the total is not known', () => {
    expect(missingOfKnown(3, null, createTranslator('fr'))).toBe('3');
  });
});
