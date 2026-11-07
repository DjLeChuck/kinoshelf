import { describe, expect, it } from 'vitest';
import { resolveSettings, type LibraryConfig, type SettingsContext } from '../src/index.js';

const context: SettingsContext = {
  source: '/downloads',
  sourceIsFile: false,
  defaultToSource: false,
  defaultMetadataLanguage: 'en-US',
};

describe('resolveSettings', () => {
  it('lets overrides win over the config, which wins over defaults', () => {
    const settings = resolveSettings(
      { dest: '/media', mode: 'hardlink', threshold: 95 },
      { mode: 'move', threshold: 70, metadataLanguage: 'fr' },
      context,
    );
    expect(settings).toMatchObject({
      mode: 'hardlink',
      threshold: 95,
      destinations: '/media',
      metadataLanguage: 'fr',
      profile: { id: 'with-id.none' },
    });
  });

  it('takes naming and metadata from the overrides, then the config, then the defaults', () => {
    const idOf = (
      ...args: Parameters<typeof resolveSettings> extends [infer O, infer C, ...unknown[]]
        ? [O, C]
        : never
    ) => resolveSettings(args[0], args[1], context).profile.id;
    expect(idOf({ dest: '/m' }, {})).toBe('with-id.none');
    expect(idOf({ dest: '/m' }, { naming: 'no-id', metadata: 'nfo' })).toBe('no-id.nfo');
    expect(idOf({ dest: '/m', metadata: 'none' }, { naming: 'no-id', metadata: 'nfo' })).toBe(
      'no-id.none',
    );
  });

  it('copies to another folder and moves when organizing in place', () => {
    expect(resolveSettings({ dest: '/media' }, {}, context).mode).toBe('copy');
    expect(resolveSettings({ dest: '/downloads' }, {}, context).mode).toBe('move');
  });

  it('keeps movies and series apart when their roots differ', () => {
    const settings = resolveSettings({ destMovies: '/movies', destSeries: '/shows' }, {}, context);
    expect(settings.destinations).toEqual({ movie: '/movies', series: '/shows' });
  });

  it('requires a destination unless the source stands in for it', () => {
    expect(() => resolveSettings({}, {}, context)).toThrow(
      expect.objectContaining({ info: { code: 'config.destination-required' } }) as Error,
    );
    const settings = resolveSettings({}, {}, { ...context, defaultToSource: true });
    expect(settings.destinations).toBe('/downloads');
  });
});

describe('resolveSettings destinations from the libraries', () => {
  const libraries: LibraryConfig[] = [
    { id: 'films', name: 'Films', source: '/m/films', type: 'movie' },
    { id: 'shows', name: 'Shows', source: '/m/shows', type: 'series' },
  ];

  it('sends each kind to the first library of its type when nothing says otherwise', () => {
    const settings = resolveSettings({}, { libraries }, context);
    expect(settings.destinations).toEqual({ movie: '/m/films', series: '/m/shows' });
  });

  it('lets an override win, and prefers a library to the folder being scanned', () => {
    expect(resolveSettings({ dest: '/x' }, { libraries }, context).destinations).toBe('/x');
    expect(
      resolveSettings({}, { libraries }, { ...context, defaultToSource: true }).destinations,
    ).toEqual({ movie: '/m/films', series: '/m/shows' });
  });

  it('needs both kinds: a library of one type is not enough', () => {
    expect(() => resolveSettings({}, { libraries: libraries.slice(0, 1) }, context)).toThrow(
      expect.objectContaining({ info: { code: 'config.destination-required' } }) as Error,
    );
  });
});
