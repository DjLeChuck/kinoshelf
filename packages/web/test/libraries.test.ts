import { describe, expect, it } from 'vitest';
import {
  folderName,
  groupOf,
  libraryBody,
  libraryForm,
  type Library,
} from '../src/lib/libraries.js';

const lastScan = { jobId: 'j1', status: 'done' as const };
const films: Library = {
  id: 'films',
  name: 'Films',
  source: '/mnt/films',
  type: 'movie',
  into: null,
  naming: 'no-id',
  metadata: 'nfo',
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
  naming: null,
  metadata: null,
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
    expect(libraryForm(films)).toMatchObject({
      group: 'in-place',
      type: 'movie',
      naming: 'no-id',
      metadata: 'nfo',
      defaultThreshold: false,
      threshold: 90,
    });
    expect(libraryForm(arrivals)).toMatchObject({
      group: 'arrival',
      into: { movie: 'films', series: 'series' },
      mode: 'hardlink',
      defaultThreshold: true,
      watch: true,
    });
  });

  it('preselects the first library of each type for a new arrival folder', () => {
    expect(libraryForm(undefined, 'arrival', [films, series]).into).toEqual({
      movie: 'films',
      series: 'series',
    });
    expect(libraryForm(undefined, 'arrival').into).toEqual({ movie: '', series: '' });
  });

  it('names a library after its folder when no name is given', () => {
    const form = { ...libraryForm(undefined), source: '/mnt/tank/downloads' };
    expect(libraryBody(form, true)).toMatchObject({ name: 'downloads' });
    expect(folderName('/')).toBe('/');
  });

  it('sends the type once, on creation, and no mode for a library organized in place', () => {
    const form = { ...libraryForm(undefined), source: '/in', type: 'series' as const };
    expect(libraryBody(form, true)).toEqual({
      name: 'in',
      source: '/in',
      type: 'series',
      watch: false,
    });
    expect(libraryBody(form, false)).toEqual({
      name: 'in',
      source: '/in',
      naming: null,
      metadata: null,
      threshold: null,
      watch: false,
    });
  });

  it('sends what a library chose, and null for what follows the settings', () => {
    const form = libraryForm(films);
    expect(libraryBody(form, false)).toMatchObject({ naming: 'no-id', metadata: 'nfo' });
    expect(libraryBody({ ...form, naming: '', metadata: '' }, false)).toMatchObject({
      naming: null,
      metadata: null,
    });
    // Nothing to unset on a creation.
    expect(libraryBody({ ...form, naming: '', metadata: '' }, true)).not.toHaveProperty('naming');
  });

  it('sends the destinations and the mode of an arrival folder, and no naming nor metadata', () => {
    const form = libraryForm(arrivals);
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

  it('refuses a relative source and a missing destination', () => {
    const arrival = libraryForm(arrivals);
    expect(libraryBody({ ...arrival, source: 'dl' }, false)).toEqual({ invalid: 'source' });
    expect(libraryBody({ ...arrival, into: { movie: 'films', series: '' } }, false)).toEqual({
      invalid: 'into',
    });
  });
});
