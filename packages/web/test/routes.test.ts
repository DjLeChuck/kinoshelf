import { describe, expect, it } from 'vitest';
import { en, fr } from '@kinoshelf/i18n';
import { matchRoute, ROUTES } from '../src/lib/routes.js';

describe('matchRoute', () => {
  it.each([
    ['/', 'queue'],
    ['/history', 'history'],
    ['/history/', 'history'],
    ['/history/3f2a', 'history'],
    ['/settings', 'settings'],
    ['/media', 'media'],
    ['/libraries', 'libraries'],
  ])('%s is %s', (path, id) => {
    expect(matchRoute(path)?.id).toBe(id);
  });

  it.each(['/nope', '/historyx', '/settings-old'])('does not take %s for a page', (path) => {
    expect(matchRoute(path)).toBeUndefined();
  });

  it('only the root is the root: it does not swallow other paths', () => {
    expect(matchRoute('/anything')).toBeUndefined();
  });

  it('names every page in both languages, and only the unfinished ones are marked soon', () => {
    for (const route of ROUTES) {
      expect(en[route.label]).toBeTruthy();
      expect(fr[route.label]).toBeTruthy();
    }
    expect(ROUTES.filter((r) => r.soon).map((r) => r.id)).toEqual(['media', 'libraries']);
  });
});
