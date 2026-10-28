import { describe, expect, it } from 'vitest';
import { resolveSettings, type SettingsContext } from '../src/index.js';

const context: SettingsContext = {
  source: '/downloads',
  sourceIsFile: false,
  defaultToSource: false,
  defaultMetadataLanguage: 'en-US',
};

describe('resolveSettings', () => {
  it('lets overrides win over the config, which wins over defaults', async () => {
    const settings = await resolveSettings(
      { mode: 'hardlink', threshold: 95 },
      { mode: 'move', threshold: 70, destination: '/media', metadataLanguage: 'fr' },
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
    expect((await resolveSettings({}, { destination: '/media' }, context)).mode).toBe('copy');
    expect((await resolveSettings({}, { destination: '/downloads' }, context)).mode).toBe('move');
  });

  it('keeps movies and series apart when their roots differ', async () => {
    const settings = await resolveSettings(
      {},
      { destination: { movies: '/movies', series: '/shows' } },
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
