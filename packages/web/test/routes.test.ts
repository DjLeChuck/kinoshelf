import { describe, expect, it } from 'vitest';
import { en, fr } from '@kinoshelf/i18n';
import { idOf, matchRoute, ROUTES } from '../src/lib/routes.js';

describe('matchRoute', () => {
  it.each([
    ['/', 'home'],
    ['/queue', 'queue'],
    ['/history', 'history'],
    ['/history/', 'history'],
    ['/history/3f2a', 'history'],
    ['/jobs/3f2a', 'history'],
    ['/settings', 'settings'],
    ['/media', 'media'],
    ['/libraries', 'libraries'],
    ['/libraries/new', 'libraries'],
    ['/libraries/ab12/scan/cd34', 'libraries'],
  ])('%s is %s', (path, id) => {
    expect(matchRoute(path)?.id).toBe(id);
  });

  it.each(['/nope', '/historyx', '/settings-old'])('does not take %s for a page', (path) => {
    expect(matchRoute(path)).toBeUndefined();
  });

  it('only the root is the root: it does not swallow other paths', () => {
    expect(matchRoute('/anything')).toBeUndefined();
  });

  it('keeps only the home and the settings while the welcome page is not left', () => {
    expect(ROUTES.filter((r) => r.firstRun).map((r) => r.id)).toEqual(['home', 'settings']);
  });

  it('names every page in both languages, and only the unfinished ones are marked soon', () => {
    for (const route of ROUTES) {
      expect(en[route.label]).toBeTruthy();
      expect(fr[route.label]).toBeTruthy();
    }
    expect(ROUTES.filter((r) => r.soon).map((r) => r.id)).toEqual(['media']);
  });
});

describe('idOf', () => {
  it('reads the id of a job or a batch page', () => {
    expect(idOf('jobs', '/jobs/3f2a')).toBe('3f2a');
    expect(idOf('jobs', '/jobs/3f2a/')).toBe('3f2a');
    expect(idOf('history', '/history/9b1c')).toBe('9b1c');
  });

  it('is empty for the list pages and for another section', () => {
    expect(idOf('jobs', '/jobs')).toBeUndefined();
    expect(idOf('history', '/history')).toBeUndefined();
    expect(idOf('jobs', '/history/9b1c')).toBeUndefined();
    expect(idOf('jobs', '/jobs/a/b')).toBeUndefined();
  });
});
