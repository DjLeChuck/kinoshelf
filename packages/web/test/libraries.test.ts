import { describe, expect, it } from 'vitest';
import {
  folderName,
  groupOf,
  libraryBody,
  libraryForm,
  type Library,
} from '../src/lib/libraries.js';

const bundled = [{ id: 'plex' }, { id: 'jellyfin' }];
const lastScan = { jobId: 'j1', status: 'done' as const };
const films: Library = {
  id: 'films',
  name: 'Films',
  source: '/mnt/films',
  type: 'movie',
  into: null,
  profile: 'jellyfin',
  mode: null,
  threshold: 90,
  watch: false,
  lastScan,
  scanning: false,
};
const series: Library = { ...films, id: 'series', name: 'Séries', type: 'series' };
const arrivals: Library = {
  ...films,
  id: 'arrivals',
  name: 'Downloads',
  source: '/mnt/dl',
  type: null,
  into: { movie: 'films', series: 'series' },
  profile: null,
  mode: 'hardlink',
  threshold: null,
  watch: true,
};

describe('the library form', () => {
  it('tells a library organized in place from an arrival folder', () => {
    expect(groupOf(films)).toBe('in-place');
    expect(groupOf(arrivals)).toBe('arrival');
  });

  it('shows a saved library as it is', () => {
    expect(libraryForm(films, bundled)).toMatchObject({
      group: 'in-place',
      type: 'movie',
      profile: { choice: 'jellyfin' },
      defaultThreshold: false,
      threshold: 90,
    });
    expect(libraryForm(arrivals, bundled)).toMatchObject({
      group: 'arrival',
      into: { movie: 'films', series: 'series' },
      mode: 'hardlink',
      defaultThreshold: true,
      watch: true,
    });
  });

  it('preselects the first library of each type for a new arrival folder', () => {
    expect(libraryForm(undefined, bundled, 'arrival', [films, series]).into).toEqual({
      movie: 'films',
      series: 'series',
    });
    expect(libraryForm(undefined, bundled, 'arrival').into).toEqual({ movie: '', series: '' });
  });

  it('names a library after its folder when no name is given', () => {
    const form = { ...libraryForm(undefined, bundled), source: '/mnt/tank/downloads' };
    expect(libraryBody(form, true)).toMatchObject({ name: 'downloads' });
    expect(folderName('/')).toBe('/');
  });

  it('sends the type once, on creation, and no mode for a library organized in place', () => {
    const form = { ...libraryForm(undefined, bundled), source: '/in', type: 'series' as const };
    expect(libraryBody(form, true)).toEqual({
      name: 'in',
      source: '/in',
      type: 'series',
      watch: false,
    });
    expect(libraryBody(form, false)).toEqual({
      name: 'in',
      source: '/in',
      profile: null,
      threshold: null,
      watch: false,
    });
  });

  it('sends the destinations and the mode of an arrival folder, and no profile', () => {
    const form = libraryForm(arrivals, bundled);
    expect(libraryBody(form, false)).toEqual({
      name: 'Downloads',
      source: '/mnt/dl',
      into: { movie: 'films', series: 'series' },
      mode: 'hardlink',
      threshold: null,
      watch: true,
    });
    expect(libraryBody({ ...form, mode: '' }, true)).not.toHaveProperty('mode');
  });

  it('refuses a relative source, a missing destination and a missing profile file', () => {
    const arrival = libraryForm(arrivals, bundled);
    expect(libraryBody({ ...arrival, source: 'dl' }, false)).toEqual({ invalid: 'source' });
    expect(libraryBody({ ...arrival, into: { movie: 'films', series: '' } }, false)).toEqual({
      invalid: 'into',
    });
    const typed = libraryForm(films, bundled);
    expect(libraryBody({ ...typed, profile: { choice: '__custom__', path: ' ' } }, false)).toEqual({
      invalid: 'profile',
    });
  });
});
