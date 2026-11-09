import { describe, expect, it } from 'vitest';
import type { ProbedFile } from '../src/lib/library-items.js';
import {
  codecLine,
  languageName,
  languageShort,
  totalSize,
  versionLabel,
} from '../src/lib/versions.js';

const file = (over: Partial<ProbedFile> = {}): ProbedFile => ({
  video: 'hevc',
  audio: 'eac3 5.1',
  hdr: null,
  audioLanguages: [],
  subtitleLanguages: [],
  size: 10,
  ...over,
});

describe('versionLabel', () => {
  it('names the size, then the dynamic range, and nothing for SDR', () => {
    expect(versionLabel('2160p', file({ hdr: 'hdr10' }))).toEqual(['2160p', 'HDR10']);
    expect(versionLabel('1080p', file())).toEqual(['1080p']);
    expect(versionLabel('1080p', null)).toEqual(['1080p']);
    expect(versionLabel(null, file({ hdr: 'dolby-vision' }))).toEqual(['Dolby Vision']);
    expect(versionLabel(null, null)).toEqual([]);
  });
});

describe('codecLine', () => {
  it('joins the codec and range, then the audio', () => {
    expect(codecLine(file({ hdr: 'hdr10-plus' }))).toBe('hevc HDR10+ · eac3 5.1');
    expect(codecLine(file({ audio: null }))).toBe('hevc');
    expect(codecLine(null)).toBe('');
  });
});

describe('languages', () => {
  it('shortens an ISO 639-2 code, either of its two forms, and keeps an unknown one', () => {
    expect(languageShort('fre')).toBe('FR');
    expect(languageShort('fra')).toBe('FR');
    expect(languageShort('eng')).toBe('EN');
    expect(languageShort('ine')).toBe('INE');
  });

  it('names a language in the language of the page', () => {
    expect(languageName('fre', 'en')).toBe('French');
    expect(languageName('fre', 'fr')).toBe('français');
    expect(languageName('ine', 'fr')).toBe('INE');
  });
});

describe('totalSize', () => {
  it('adds what is known and says nothing when nothing is', () => {
    expect(totalSize([file({ size: 4 }), null, file({ size: 6 })])).toBe(10);
    expect(totalSize([null])).toBeNull();
  });
});
