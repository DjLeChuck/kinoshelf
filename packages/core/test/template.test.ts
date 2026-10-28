import { describe, expect, it } from 'vitest';
import { KinoshelfError, parseTemplate, renderTemplate } from '../src/index.js';
import type { RenderContext } from '../src/index.js';

const context: RenderContext = {
  rules: { forbidden: 'windows', replacement: '', maxSegmentBytes: 255 },
  rangeSeparator: '-e',
};

const render = (source: string, variables: Parameters<typeof renderTemplate>[1], ctx = context) =>
  renderTemplate(parseTemplate(source), variables, ctx);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof KinoshelfError ? error.info.code : 'unexpected';
  }
  return undefined;
}

describe('parseTemplate / renderTemplate', () => {
  it('substitutes variables and keeps literal text', () => {
    expect(render('{title} ({year})', { title: 'Dune', year: 2021 })).toEqual(['Dune (2021)']);
  });

  it('zero-pads numbers', () => {
    expect(render('Season {season:02}', { season: 3 })).toEqual(['Season 03']);
    expect(render('s{season:02}e{episode:03}', { season: 3, episode: 4 })).toEqual(['s03e004']);
  });

  it('produces literal braces with backslash escapes', () => {
    expect(render('{title} \\{tmdb-{tmdb}\\}', { title: 'Dune', tmdb: 438631 })).toEqual([
      'Dune {tmdb-438631}',
    ]);
  });

  it('renders a list as first and last value', () => {
    expect(render('e{episode:02}', { episode: [18, 19] })).toEqual(['e18-e19']);
    expect(render('e{episode:02}', { episode: [18, 19, 20] })).toEqual(['e18-e20']);
    expect(render('e{episode:02}', { episode: [5] })).toEqual(['e05']);
  });

  it('splits segments on literal slashes only', () => {
    expect(render('{title}/Season {season:02}', { title: 'AC/DC', season: 1 })).toEqual([
      'ACDC',
      'Season 01',
    ]);
  });

  it('renders an empty template as no segment', () => {
    expect(render('', {})).toEqual([]);
  });

  it('removes forbidden characters from values, not from literal text', () => {
    expect(render('{title}', { title: 'Mission: Impossible?' })).toEqual(['Mission Impossible']);
    expect(
      render(
        '{title}',
        { title: 'Mission: Impossible' },
        {
          ...context,
          rules: { forbidden: 'windows', replacement: ' -', maxSegmentBytes: 255 },
        },
      ),
    ).toEqual(['Mission - Impossible']);
  });

  it('keeps colons on POSIX filesystems but still strips slashes', () => {
    const posix: RenderContext = {
      ...context,
      rules: { forbidden: 'posix', replacement: '', maxSegmentBytes: 255 },
    };
    expect(render('{title}', { title: 'Mission: Impossible/2' }, posix)).toEqual([
      'Mission: Impossible2',
    ]);
  });

  it('strips trailing dots and spaces on Windows-style rules', () => {
    expect(render('{title}', { title: 'Mr. Robot.' })).toEqual(['Mr. Robot']);
  });

  it('truncates on a code point boundary, leaving room for the extension', () => {
    const ctx: RenderContext = {
      ...context,
      rules: { forbidden: 'posix', replacement: '', maxSegmentBytes: 20 },
      reserveBytes: 4,
    };
    const [segment] = render('{title}', { title: 'é'.repeat(30) }, ctx);
    expect(Buffer.byteLength(segment ?? '', 'utf8')).toBeLessThanOrEqual(16);
    expect(segment).toBe('é'.repeat(8));
  });

  it.each([
    ['{title', 'template.invalid-variable'],
    ['{ti tle}', 'template.invalid-variable'],
    ['{title:2}', 'template.invalid-variable'],
    ['title}', 'template.unexpected-brace'],
    ['\\n', 'template.invalid-escape'],
    ['{tmdb-{tmdb}}', 'template.invalid-variable'],
  ])('rejects malformed template %j', (source, code) => {
    expect(codeOf(() => parseTemplate(source))).toBe(code);
  });

  it('reports missing variables, padding on text and empty segments', () => {
    expect(codeOf(() => render('{title}', {}))).toBe('template.missing-variable');
    expect(codeOf(() => render('{title:02}', { title: 'x' }))).toBe('template.pad-on-text');
    expect(codeOf(() => render('{title}', { title: '???' }))).toBe('template.empty-segment');
  });
});
