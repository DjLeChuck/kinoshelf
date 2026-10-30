import { createTranslator } from '@kinoshelf/i18n';
import { describe, expect, it } from 'vitest';
import {
  CUSTOM_PROFILE,
  cleanMappings,
  destinationForm,
  destinationOf,
  isHttpUrl,
  nullIfBlank,
  profileForm,
  profileHelp,
  profileName,
  profileOf,
  secondsOf,
  thresholdOf,
  watchForm,
  watchPatch,
  webhookRows,
  webhooksPatch,
} from '../src/lib/settings.js';

describe('nullIfBlank', () => {
  it('unsets an emptied field and trims the rest', () => {
    expect(nullIfBlank('  ')).toBeNull();
    expect(nullIfBlank(' plex ')).toBe('plex');
  });
});

describe('thresholdOf', () => {
  it.each([
    ['', null],
    ['85', 85],
    ['72,5', 72.5],
    ['0', 0],
    ['100', 100],
    ['101', undefined],
    ['-1', undefined],
    ['abc', undefined],
  ])('%j gives %j', (text, expected) => {
    expect(thresholdOf(text)).toBe(expected);
  });
});

describe('destination', () => {
  it('reads a single folder and separate ones back into the form', () => {
    expect(destinationForm('/media')).toMatchObject({ separate: false, single: '/media' });
    expect(destinationForm({ movies: '/m', series: '/s' })).toMatchObject({
      separate: true,
      movies: '/m',
      series: '/s',
    });
    expect(destinationForm(null)).toMatchObject({ separate: false, single: '' });
  });

  it('writes one folder, two, or none', () => {
    const form = { separate: false, single: ' /media ', movies: '', series: '' };
    expect(destinationOf(form)).toBe('/media');
    expect(destinationOf({ ...form, single: '' })).toBeNull();
    expect(destinationOf({ ...form, separate: true, movies: '/m', series: '/s' })).toEqual({
      movies: '/m',
      series: '/s',
    });
    expect(destinationOf({ ...form, separate: true })).toBeNull();
  });

  it('refuses separate folders when only one is given: the other kind would have no home', () => {
    expect(destinationOf({ separate: true, single: '', movies: '/m', series: '' })).toBeUndefined();
  });
});

describe('cleanMappings', () => {
  it('drops the rows left half empty', () => {
    expect(
      cleanMappings([
        { from: ' /a ', to: '/b' },
        { from: '/c', to: '' },
        { from: '', to: '' },
      ]),
    ).toEqual([{ from: '/a', to: '/b' }]);
  });
});

describe('webhooksPatch', () => {
  const settings = [
    {
      id: 'abc',
      target: 'https://ntfy.sh',
      format: 'ntfy' as const,
      on: ['failed' as const],
      headerNames: ['x'],
    },
  ];

  it('names an existing webhook by its id, and never sends back a URL it was not given', () => {
    const [hook] = webhooksPatch(webhookRows(settings));
    expect(hook).toEqual({ id: 'abc', format: 'ntfy', on: ['failed'] });
  });

  it('sends a new webhook with its URL, and ignores a blank new row', () => {
    const rows = [
      ...webhookRows(settings),
      { url: ' https://hook.example/x ', format: 'generic' as const, on: ['transferred' as const] },
      { url: '  ', format: 'generic' as const, on: ['transferred' as const] },
    ];
    const patch = webhooksPatch(rows);
    expect(patch).toHaveLength(2);
    expect(patch[1]).toEqual({
      url: 'https://hook.example/x',
      format: 'generic',
      on: ['transferred'],
    });
  });

  it('removes a webhook by leaving it out', () => {
    expect(webhooksPatch([])).toEqual([]);
  });
});

describe('isHttpUrl', () => {
  it.each([
    ['http://plex:32400', true],
    ['https://example.org/x', true],
    ['plex:32400', false],
    ['ftp://example.org', false],
    ['', false],
  ])('%j is %s', (text, expected) => {
    expect(isHttpUrl(text)).toBe(expected);
  });
});

describe('profile', () => {
  const bundled = [{ id: 'plex' }];

  it('reads a bundled id, the default and a path back into the form', () => {
    expect(profileForm(null, bundled)).toEqual({ choice: '', path: '' });
    expect(profileForm('plex', bundled)).toEqual({ choice: 'plex', path: '' });
    expect(profileForm('/config/mine.yaml', bundled)).toEqual({
      choice: CUSTOM_PROFILE,
      path: '/config/mine.yaml',
    });
  });

  it('saves the choice, or the path of the user’s own file', () => {
    expect(profileOf({ choice: '', path: '' })).toBeNull();
    expect(profileOf({ choice: 'plex', path: '/ignored' })).toBe('plex');
    expect(profileOf({ choice: CUSTOM_PROFILE, path: ' /config/mine.yaml ' })).toBe(
      '/config/mine.yaml',
    );
  });

  it('refuses "my own file" without a path', () => {
    expect(profileOf({ choice: CUSTOM_PROFILE, path: '  ' })).toBeUndefined();
  });
});

describe('secondsOf', () => {
  it.each([
    ['', null],
    [' 45 ', 45],
    ['0', 0],
    ['-1', undefined],
    ['1.5', undefined],
    ['soon', undefined],
  ])('%j gives %j', (text, expected) => {
    expect(secondsOf(text)).toBe(expected);
  });
});

describe('the watch form', () => {
  const settings = {
    folders: ['/downloads/done'],
    settleSeconds: 30,
    pollSeconds: null,
    apply: true,
  };

  it('starts off, with one empty folder to fill', () => {
    expect(watchForm(null)).toEqual({
      enabled: false,
      folders: [{ path: '' }],
      settle: '',
      poll: '',
      apply: false,
    });
  });

  it('shows what is saved', () => {
    expect(watchForm(settings)).toEqual({
      enabled: true,
      folders: [{ path: '/downloads/done' }],
      settle: '30',
      poll: '',
      apply: true,
    });
  });

  it('turns the switch off into removing the setting, whatever else is typed', () => {
    expect(watchPatch({ ...watchForm(settings), enabled: false })).toEqual({ watch: null });
  });

  it('sends the trimmed folders and the numbers, an empty field unsetting its value', () => {
    const form = {
      ...watchForm(settings),
      folders: [{ path: ' /downloads/done ' }, { path: '  ' }],
    };
    expect(watchPatch(form)).toEqual({
      watch: { folders: ['/downloads/done'], settleSeconds: 30, pollSeconds: null, apply: true },
    });
  });

  it('refuses no folder, a relative one, and seconds that are not a number', () => {
    const form = watchForm(settings);
    expect(watchPatch({ ...form, folders: [{ path: ' ' }] })).toEqual({ invalid: 'folders' });
    expect(watchPatch({ ...form, folders: [{ path: 'downloads' }] })).toEqual({
      invalid: 'folders',
    });
    expect(watchPatch({ ...form, poll: 'often' })).toEqual({ invalid: 'seconds' });
  });
});

describe('profile texts', () => {
  const t = createTranslator('fr');

  it('translates the name of a shipped profile and falls back to the file’s own name', () => {
    expect(profileName({ id: 'plex-no-id', name: 'Plex (no id)' }, t)).toBe('Plex (sans id)');
    expect(profileName({ id: 'mine', name: 'My profile' }, t)).toBe('My profile');
  });

  it('describes a shipped profile only', () => {
    expect(profileHelp('plex-no-id', t)).toContain('sans l’id TMDB');
    expect(profileHelp('mine', t)).toBeNull();
  });
});
