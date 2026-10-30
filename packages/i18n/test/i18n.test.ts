import { ERROR_CODES } from '@kinoshelf/core';
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES, CLI_ERROR_CODES, SERVER_ERROR_CODES } from '../src/codes.js';
import { en } from '../src/en.js';
import { fr } from '../src/fr.js';
import { placeholdersOf as placeholders } from '../src/format.js';
import { createTranslator, describeError, detectLocale } from '../src/index.js';

describe('catalogs', () => {
  it('have exactly the same keys', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it.each(Object.keys(en) as (keyof typeof en)[])(
    '%s has the same parameters in both languages',
    (key) => {
      expect(placeholders(fr[key])).toEqual(placeholders(en[key]));
    },
  );

  it('write every plural so that it can be read', () => {
    for (const catalog of [en, fr]) {
      for (const [key, text] of Object.entries(catalog)) {
        if (text.includes('plural')) {
          const names = Object.fromEntries(placeholders(text).map((name) => [name, 2]));
          expect(
            createTranslator(catalog === en ? 'en' : 'fr')(key as keyof typeof en, names),
          ).not.toContain('plural');
        }
      }
    }
  });

  it('never leave a message empty or untranslated', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(en[key].trim()).not.toBe('');
      expect(fr[key].trim()).not.toBe('');
    }
    // Technical tokens aside, a French message identical to the English one is a missed one.
    // Words spelled the same in both languages are listed here, so a real omission still shows.
    const SAME_IN_BOTH: readonly string[] = [
      'entry.score',
      'web.home.suggest.eyebrow',
      'web.home.services.title',
    ];
    const identical = (Object.keys(en) as (keyof typeof en)[]).filter(
      (key) => fr[key] === en[key] && !key.startsWith('entry.') && !SAME_IN_BOTH.includes(key),
    );
    expect(identical).toEqual([]);
  });

  it('translate every error code the core, the CLI, the server and its API can raise', () => {
    for (const code of [
      ...ERROR_CODES,
      ...CLI_ERROR_CODES,
      ...SERVER_ERROR_CODES,
      ...API_ERROR_CODES,
    ]) {
      expect(en).toHaveProperty([`error.${code}`]);
      expect(fr).toHaveProperty([`error.${code}`]);
    }
  });

  it('use typographic apostrophes and accents in French', () => {
    expect(fr['report.none']).toBe('Aucun fichier vidéo trouvé.');
    expect(fr['notice.dry-run']).toContain('n’a');
  });
});

describe('createTranslator', () => {
  it('fills parameters, numbers included', () => {
    expect(
      createTranslator('en')('summary.line', {
        compliant: 1,
        toRename: 2,
        conflict: 3,
        ambiguous: 4,
        unrecognized: 5,
      }),
    ).toBe('Summary: 1 in place, 2 to organize, 3 held back, 4 ambiguous, 5 unrecognized.');
  });

  it('keeps a placeholder that has no value', () => {
    expect(createTranslator('en')('error.source.missing')).toBe('Source file not found: {path}');
  });

  it('translates to French', () => {
    expect(createTranslator('fr')('undo.nothing')).toBe('Rien à annuler.');
  });
});

describe('describeError', () => {
  const t = createTranslator('en');

  it('uses the error catalog with the parameters', () => {
    expect(describeError(t, { code: 'source.missing', params: { path: '/a/b.mkv' } })).toBe(
      'Source file not found: /a/b.mkv',
    );
  });

  it('falls back to a generic message for an unknown code', () => {
    expect(describeError(t, { code: 'brand.new' })).toBe('Unexpected error (brand.new).');
  });
});

describe('detectLocale', () => {
  it.each([
    ['fr', undefined, {}, 'fr'],
    ['en', 'fr', { LANG: 'fr_FR.UTF-8' }, 'en'],
    [undefined, 'fr', { LANG: 'en_US.UTF-8' }, 'fr'],
    [undefined, undefined, { LANG: 'fr_FR.UTF-8' }, 'fr'],
    [undefined, undefined, { LC_ALL: 'fr_CA.UTF-8', LANG: 'en_US.UTF-8' }, 'fr'],
    [undefined, undefined, { LANG: 'de_DE.UTF-8' }, 'en'],
    [undefined, undefined, {}, 'en'],
    ['klingon', undefined, { LANG: 'fr_FR.UTF-8' }, 'fr'],
  ] as const)('flag %j, config %j, env %j → %s', (flag, configured, env, expected) => {
    expect(detectLocale(flag, configured, env)).toBe(expected);
  });
});
