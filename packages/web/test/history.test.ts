import { describe, expect, it } from 'vitest';
import { en, fr } from '@kinoshelf/i18n';
import {
  STATUS_CHIP,
  canUndo,
  analysed,
  formatDate,
  formatDuration,
  originOf,
  resendRequest,
  rootsOf,
  tally,
  type BatchStatus,
  type UndoReport,
} from '../src/lib/history.js';

describe('canUndo', () => {
  it.each([
    ['done', true],
    ['undone', false],
    ['failed', false],
  ] as const)('a %s batch: %s', (status, expected) => {
    expect(canUndo({ status })).toBe(expected);
  });
});

describe('statuses', () => {
  it('have a chip and a text in both languages', () => {
    for (const status of Object.keys(STATUS_CHIP) as BatchStatus[]) {
      expect(en[`web.history.status.${status}`]).toBeTruthy();
      expect(fr[`web.history.status.${status}`]).toBeTruthy();
    }
  });
});

describe('tally', () => {
  it('counts each outcome of an undo', () => {
    const entry = (status: 'undone' | 'skipped' | 'failed') => ({
      source: 'a',
      destination: 'b',
      mode: 'move' as const,
      status,
      error: null,
    });
    const report: UndoReport = {
      batchId: 'b1',
      dryRun: false,
      entries: [entry('undone'), entry('undone'), entry('skipped'), entry('failed')],
    };
    expect(tally(report)).toEqual({ undone: 2, skipped: 1, failed: 1 });
  });
});

describe('formatDate', () => {
  it('follows the language', () => {
    const iso = '2026-10-29T14:05:00Z';
    expect(formatDate(iso, 'en')).toMatch(/Oct/);
    expect(formatDate(iso, 'fr')).toMatch(/oct/);
  });

  it('shows what it cannot read as it came', () => {
    expect(formatDate('not a date', 'en')).toBe('not a date');
  });
});

describe('originOf', () => {
  it('is the submitted path, and nothing for the command line', () => {
    expect(originOf({ origin: { jobId: 'j', path: '/downloads' } })).toBe('/downloads');
    expect(originOf({ origin: null })).toBeUndefined();
  });
});

describe('resendRequest', () => {
  const films = { id: 'films', source: '/media/films', type: 'movie' as const };
  const arrivals = { id: 'incoming', source: '/downloads', type: null };

  it('sends the scan of a library through the library, which refuses a second one', () => {
    expect(
      resendRequest({ path: '/media/films', apply: false, libraryId: 'films' }, [films]),
    ).toEqual({ url: '/api/libraries/films/scan', body: {} });
  });

  it('sends the scan of one folder of a library through the library too', () => {
    expect(
      resendRequest({ path: '/media/films/Dune (2021)', apply: false, libraryId: 'films' }, [
        films,
      ]),
    ).toEqual({
      url: '/api/libraries/films/rescan',
      body: { path: '/media/films/Dune (2021)' },
    });
  });

  it('submits a release of an arrival folder as it was, with its choice to apply', () => {
    expect(
      resendRequest({ path: '/downloads/Dune.2021', apply: true, libraryId: 'incoming' }, [
        films,
        arrivals,
      ]),
    ).toEqual({ url: '/api/jobs', body: { path: '/downloads/Dune.2021', apply: true } });
  });

  it('falls back to a plain submission when the library is gone', () => {
    expect(resendRequest({ path: '/media/films', apply: false, libraryId: 'films' }, [])).toEqual({
      url: '/api/jobs',
      body: { path: '/media/films', apply: false },
    });
  });

  it('submits a path sent by hand, which belongs to no library', () => {
    expect(resendRequest({ path: '/x', apply: false, libraryId: null }, [films]).url).toBe(
      '/api/jobs',
    );
  });
});

describe('formatDuration', () => {
  it.each([
    ['2026-10-29T10:00:00Z', '2026-10-29T10:00:02Z', '2 s'],
    ['2026-10-29T10:00:00Z', '2026-10-29T10:01:12Z', '1 min 12 s'],
    ['2026-10-29T10:00:00Z', '2026-10-29T10:00:00Z', '1 s'],
  ])('%s to %s is %s', (from, to, expected) => {
    expect(formatDuration(from, to)).toBe(expected);
  });

  it('says nothing when the end is before the start, or not a date', () => {
    expect(formatDuration('2026-10-29T10:00:02Z', '2026-10-29T10:00:00Z')).toBeUndefined();
    expect(formatDuration('x', 'y')).toBeUndefined();
  });
});

describe('analysed', () => {
  it('adds up every classification, and is zero before the analysis ends', () => {
    expect(analysed({ 'to-rename': 2, compliant: 3, conflict: 0 })).toBe(5);
    expect(analysed(null)).toBe(0);
  });
});

describe('rootsOf', () => {
  it('gives one root for both kinds, or one for each', () => {
    expect(rootsOf('/media')).toEqual({ movies: '/media', series: '/media' });
    expect(rootsOf({ movie: '/films', series: '/series' })).toEqual({
      movies: '/films',
      series: '/series',
    });
  });
});
