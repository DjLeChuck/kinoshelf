import { describe, expect, it } from 'vitest';
import { en, fr } from '@kinoshelf/i18n';
import {
  STATUS_CHIP,
  canUndo,
  formatDate,
  originOf,
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
