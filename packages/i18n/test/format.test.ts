import { describe, expect, it } from 'vitest';
import { formatMessage, placeholdersOf } from '../src/format.js';

const FILES =
  '{count, plural, =0 {Aucun fichier} one {# fichier} other {# fichiers}} dans {folder}';

describe('formatMessage', () => {
  it('fills parameters, numbers included, and keeps those with no value', () => {
    expect(formatMessage('{a} et {b} et {c}', { a: 'x', b: 2 }, 'en')).toBe('x et 2 et {c}');
  });

  it('leaves other braces alone', () => {
    expect(formatMessage('use \\{ or \\} here, {x}', { x: 1 }, 'en')).toBe(
      'use \\{ or \\} here, 1',
    );
  });

  it('picks the plural category of the language', () => {
    const text = '{n, plural, one {# file} other {# files}}';
    expect(formatMessage(text, { n: 1 }, 'en')).toBe('1 file');
    expect(formatMessage(text, { n: 0 }, 'en')).toBe('0 files');
    expect(formatMessage(text, { n: 5 }, 'en')).toBe('5 files');
  });

  it('counts 0 as singular in French unless =0 says otherwise', () => {
    const text = '{n, plural, one {# fichier} other {# fichiers}}';
    expect(formatMessage(text, { n: 0 }, 'fr')).toBe('0 fichier');
    expect(formatMessage(text, { n: 1 }, 'fr')).toBe('1 fichier');
    expect(formatMessage(text, { n: 2 }, 'fr')).toBe('2 fichiers');
    expect(formatMessage(FILES, { count: 0, folder: 'A' }, 'fr')).toBe('Aucun fichier dans A');
    expect(formatMessage(FILES, { count: 1, folder: 'A' }, 'fr')).toBe('1 fichier dans A');
    expect(formatMessage(FILES, { count: 3, folder: 'A' }, 'fr')).toBe('3 fichiers dans A');
  });

  it('prefers an exact value to the category', () => {
    expect(
      formatMessage('{n, plural, =1 {just one} one {# one} other {many}}', { n: 1 }, 'en'),
    ).toBe('just one');
  });

  it('reads a count given as text, and takes `other` for one that is not a number', () => {
    const text = '{n, plural, one {# file} other {# files}}';
    expect(formatMessage(text, { n: '1' }, 'en')).toBe('1 file');
    expect(formatMessage(text, { n: '200+' }, 'en')).toBe('200+ files');
    expect(formatMessage(text, { n: '' }, 'en')).toBe(' files');
  });

  it('allows parameters, other plurals and newlines inside a branch', () => {
    const text = `{done, plural,
      one {# done}
      other {# done}
    }, {failed, plural, =0 {none failed} other {# failed ({where})}}`;
    expect(formatMessage(text, { done: 2, failed: 3, where: 'here' }, 'en')).toBe(
      '2 done, 3 failed (here)',
    );
    expect(formatMessage(text, { done: 1, failed: 0, where: 'here' }, 'en')).toBe(
      '1 done, none failed',
    );
  });

  it('keeps a plural with no count, and a malformed one, as they are', () => {
    expect(formatMessage('{n, plural, one {a} other {b}}', {}, 'en')).toBe(
      '{n, plural, one {a} other {b}}',
    );
    expect(formatMessage('{n, plural, one {a}}', { n: 1 }, 'en')).toBe('{n, plural, one {a}}');
    expect(formatMessage('{n, plural, one {a', { n: 1 }, 'en')).toBe('{n, plural, one {a');
  });

  it('writes # as is outside a plural', () => {
    expect(formatMessage('issue #{n}', { n: 4 }, 'en')).toBe('issue #4');
  });
});

describe('placeholdersOf', () => {
  it('lists every parameter, those of a plural and of its branches included', () => {
    expect(placeholdersOf(FILES)).toEqual(['count', 'folder']);
    expect(placeholdersOf('{b} {a} {b}')).toEqual(['a', 'b']);
    expect(placeholdersOf('{n, plural, one {# {x}} other {# {y}}}')).toEqual(['n', 'x', 'y']);
  });
});
