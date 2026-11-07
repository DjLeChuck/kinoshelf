import { describe, expect, it } from 'vitest';
import {
  cleanMappings,
  isHttpUrl,
  nullIfBlank,
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

  it('starts empty when nothing is watched', () => {
    expect(watchForm(null)).toEqual({ settle: '', poll: '', apply: false });
  });

  it('shows what is saved', () => {
    expect(watchForm(settings)).toEqual({ settle: '30', poll: '', apply: true });
  });

  it('sends the numbers, an empty field unsetting its value, and never the folders', () => {
    expect(watchPatch(watchForm(settings))).toEqual({
      watch: { settleSeconds: 30, pollSeconds: null, apply: true },
    });
  });

  it('refuses seconds that are not a number', () => {
    expect(watchPatch({ ...watchForm(settings), poll: 'often' })).toEqual({ invalid: 'seconds' });
  });
});
