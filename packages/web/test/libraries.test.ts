import { describe, expect, it } from 'vitest';
import {
  folderName,
  libraryBody,
  libraryForm,
  extrasTally,
  libraryRoute,
  type Library,
} from '../src/lib/libraries.js';
import {
  extrasLabel,
  isSelected,
  scoreLabel,
  selectedIds,
  toggleAll,
  toggleRow,
} from '../src/lib/scan.js';

const bundled = [{ id: 'plex' }, { id: 'jellyfin' }];
const counts = { rename: 1, conflict: 0, ambiguous: 0, unrecognized: 0, compliant: 0, renamed: 0 };
const library: Library = {
  id: 'a1',
  name: 'Films',
  source: '/mnt/films',
  destination: { movies: '/m', series: '/s' },
  profile: 'jellyfin',
  scanning: false,
  mode: 'hardlink',
  threshold: 90,
  watch: true,
  lastScan: { jobId: 'j1', status: 'done' as const, finishedAt: '2026-01-01T00:00:00Z', counts },
};

describe('libraryRoute', () => {
  it.each([
    ['/libraries', { page: 'list' }],
    ['/libraries/', { page: 'list' }],
    ['/libraries/new', { page: 'new' }],
    ['/libraries/a1', { page: 'edit', id: 'a1' }],
    ['/libraries/a1/scan/j1', { page: 'scan', id: 'a1', jobId: 'j1' }],
  ])('reads %s', (path, expected) => {
    expect(libraryRoute(path)).toEqual(expected);
  });

  it.each(['/queue', '/libraries/a1/scan', '/libraries/a1/other/j1', '/libraries/a1/scan/j1/x'])(
    'does not read %s',
    (path) => {
      expect(libraryRoute(path)).toBeUndefined();
    },
  );
});

describe('the library form', () => {
  it('shows a saved library and an empty one that inherits everything', () => {
    expect(libraryForm(library, bundled)).toMatchObject({
      name: 'Films',
      profile: { choice: 'jellyfin' },
      mode: 'hardlink',
      defaultThreshold: false,
      threshold: 90,
      watch: true,
      destination: { separate: true, movies: '/m' },
      defaultDestination: false,
    });
    expect(libraryForm(undefined, bundled)).toMatchObject({
      profile: { choice: '' },
      mode: '',
      defaultThreshold: true,
      defaultDestination: true,
      watch: false,
    });
  });

  it('ignores a typed destination while the default is chosen', () => {
    const form = {
      ...libraryForm(undefined, bundled),
      source: '/in',
      destination: { separate: false, single: '/typed', movies: '', series: '' },
    };
    expect(libraryBody({ ...form, defaultDestination: false }, true)).toMatchObject({
      destination: '/typed',
    });
    expect(libraryBody(form, false)).toMatchObject({ destination: null });
  });

  it('names a library after its folder when no name is given', () => {
    const form = { ...libraryForm(undefined, bundled), source: '/mnt/tank/downloads' };
    expect(libraryBody(form, true)).toMatchObject({
      name: 'downloads',
      source: '/mnt/tank/downloads',
    });
    expect(folderName('/')).toBe('/');
  });

  it('leaves blank fields out of a creation and unsets them on an update', () => {
    const form = { ...libraryForm(undefined, bundled), source: '/in' };
    expect(libraryBody(form, true)).toEqual({ name: 'in', source: '/in', watch: false });
    expect(libraryBody(form, false)).toEqual({
      name: 'in',
      source: '/in',
      destination: null,
      profile: null,
      mode: null,
      threshold: null,
      watch: false,
    });
  });

  it('refuses a relative source, half a destination and a missing profile file', () => {
    const form = libraryForm(library, bundled);
    expect(libraryBody({ ...form, source: 'films' }, false)).toEqual({ invalid: 'source' });
    expect(
      libraryBody({ ...form, destination: { ...form.destination, series: '' } }, false),
    ).toEqual({ invalid: 'destination' });
    expect(libraryBody({ ...form, profile: { choice: '__custom__', path: ' ' } }, false)).toEqual({
      invalid: 'profile',
    });
  });
});

describe('the scan selection', () => {
  const rows = [
    { id: 'a', from: 'a.mkv', to: 'A/a.mkv', score: 98, extras: [] },
    { id: 'b', from: 'b.mkv', to: 'B/b.mkv', score: 100, extras: [] },
  ];

  it('starts with every row selected and keeps what the user took out', () => {
    const off = toggleRow(new Set(), 'a');
    expect(isSelected(off, 'a')).toBe(false);
    expect(selectedIds(rows, off)).toEqual(['b']);
    expect(selectedIds(rows, toggleRow(off, 'a'))).toEqual(['a', 'b']);
  });

  it('selects all, or none when all are already selected', () => {
    expect(selectedIds(rows, toggleAll(new Set(), rows))).toEqual([]);
    expect(selectedIds(rows, toggleAll(new Set(['a']), rows))).toEqual(['a', 'b']);
  });

  it('shows a percentage only for an uncertain score', () => {
    expect(scoreLabel(91.4)).toBe('91 %');
    expect(scoreLabel(100)).toBeUndefined();
    expect(scoreLabel(null)).toBeUndefined();
  });
});

describe('the NFO and images of a scan', () => {
  it('names the files a row writes beside its video', () => {
    expect(extrasLabel([])).toBe('');
    expect(
      extrasLabel([
        { type: 'nfo', destination: '/lib/Dune (2021)/movie.nfo' },
        { type: 'image', destination: '/lib/Dune (2021)/poster.jpg' },
      ]),
    ).toBe('movie.nfo, poster.jpg');
  });

  it('counts what a dry run would write, apart from what is already there', () => {
    expect(
      extrasTally([
        { type: 'transfer', status: 'done' },
        { type: 'write-file', status: 'done' },
        { type: 'download', status: 'done' },
        { type: 'download', status: 'skipped' },
        { type: 'write-file', status: 'failed' },
      ]),
    ).toEqual({ nfo: 1, images: 1, skipped: 1 });
  });
});
