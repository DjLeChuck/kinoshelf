import { describe, expect, it } from 'vitest';
import {
  cleanMappings,
  destinationForm,
  destinationOf,
  isHttpUrl,
  nullIfBlank,
  thresholdOf,
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
