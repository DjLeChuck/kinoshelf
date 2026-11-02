import { describe, expect, it } from 'vitest';
import { resolveSettings, type LibraryConfig, type SettingsContext } from '../src/index.js';

const context: SettingsContext = {
  source: '/downloads',
  sourceIsFile: false,
  defaultToSource: false,
  defaultMetadataLanguage: 'en-US',
};

describe('resolveSettings', () => {
  it('lets overrides win over the config, which wins over defaults', async () => {
    const settings = await resolveSettings(
      { dest: '/media', mode: 'hardlink', threshold: 95 },
      { mode: 'move', threshold: 70, metadataLanguage: 'fr' },
      context,
    );
    expect(settings).toMatchObject({
      mode: 'hardlink',
      threshold: 95,
      destinations: '/media',
      metadataLanguage: 'fr',
      profile: { id: 'plex' },
    });
  });

  it('copies to another folder and moves when organizing in place', async () => {
    expect((await resolveSettings({ dest: '/media' }, {}, context)).mode).toBe('copy');
    expect((await resolveSettings({ dest: '/downloads' }, {}, context)).mode).toBe('move');
  });

  it('keeps movies and series apart when their roots differ', async () => {
    const settings = await resolveSettings(
      { destMovies: '/movies', destSeries: '/shows' },
      {},
      context,
    );
    expect(settings.destinations).toEqual({ movie: '/movies', series: '/shows' });
  });

  it('requires a destination unless the source stands in for it', async () => {
    await expect(resolveSettings({}, {}, context)).rejects.toMatchObject({
      info: { code: 'config.destination-required' },
    });
    const settings = await resolveSettings({}, {}, { ...context, defaultToSource: true });
    expect(settings.destinations).toBe('/downloads');
  });
});

describe('resolveSettings destinations from the libraries', () => {
  const libraries: LibraryConfig[] = [
    { id: 'films', name: 'Films', source: '/m/films', type: 'movie' },
    { id: 'shows', name: 'Shows', source: '/m/shows', type: 'series' },
  ];

  it('sends each kind to the first library of its type when nothing says otherwise', async () => {
    const settings = await resolveSettings({}, { libraries }, context);
    expect(settings.destinations).toEqual({ movie: '/m/films', series: '/m/shows' });
  });

  it('lets an override win, and prefers a library to the folder being scanned', async () => {
    expect((await resolveSettings({ dest: '/x' }, { libraries }, context)).destinations).toBe('/x');
    expect(
      (await resolveSettings({}, { libraries }, { ...context, defaultToSource: true }))
        .destinations,
    ).toEqual({ movie: '/m/films', series: '/m/shows' });
  });

  it('needs both kinds: a library of one type is not enough', async () => {
    await expect(
      resolveSettings({}, { libraries: libraries.slice(0, 1) }, context),
    ).rejects.toMatchObject({ info: { code: 'config.destination-required' } });
  });
});
