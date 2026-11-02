import { describe, expect, it } from 'vitest';
import { en, fr } from '@kinoshelf/i18n';
import { batchIdOf, matchRoute, ROUTES } from '../src/lib/routes.js';

describe('matchRoute', () => {
  it.each([
    ['/libraries', 'libraries'],
    ['/libraries/', 'libraries'],
    ['/libraries/films', 'libraries'],
    ['/arrivals', 'libraries'],
    ['/history', 'history'],
    ['/history/', 'history'],
    ['/history/3f2a', 'history'],
    ['/settings', 'settings'],
  ])('%s is %s', (path, id) => {
    expect(matchRoute(path)?.id).toBe(id);
  });

  it.each(['/', '/nope', '/historyx', '/settings-old', '/queue', '/jobs/3f2a', '/media'])(
    'does not take %s for a page',
    (path) => {
      expect(matchRoute(path)).toBeUndefined();
    },
  );

  it('has three entries, and keeps only the settings while the welcome page is not left', () => {
    expect(ROUTES.map((r) => r.id)).toEqual(['libraries', 'history', 'settings']);
    expect(ROUTES.filter((r) => r.firstRun).map((r) => r.id)).toEqual(['settings']);
  });

  it('names every page in both languages', () => {
    for (const route of ROUTES) {
      expect(en[route.label]).toBeTruthy();
      expect(fr[route.label]).toBeTruthy();
    }
  });
});

describe('batchIdOf', () => {
  it('reads the id of a batch page', () => {
    expect(batchIdOf('/history/9b1c')).toBe('9b1c');
    expect(batchIdOf('/history/9b1c/')).toBe('9b1c');
  });

  it('is empty for the list page and for another section', () => {
    expect(batchIdOf('/history')).toBeUndefined();
    expect(batchIdOf('/jobs/9b1c')).toBeUndefined();
    expect(batchIdOf('/history/a/b')).toBeUndefined();
  });
});
