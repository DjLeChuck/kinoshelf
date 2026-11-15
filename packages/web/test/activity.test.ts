import { describe, expect, it } from 'vitest';
import { createTranslator } from '@kinoshelf/i18n';
import {
  labelOf,
  ordered,
  overallPercent,
  percentOf,
  phaseOf,
  type ActivityTask,
} from '../src/lib/activity.js';

const task = (fields: Partial<ActivityTask> & { id: string }): ActivityTask => ({
  kind: 'test',
  code: 'transfer',
  params: {},
  status: 'running',
  done: null,
  total: null,
  current: null,
  href: null,
  error: null,
  ...fields,
});

describe('percentOf', () => {
  it('is undefined while the task cannot count', () => {
    expect(percentOf({ done: null, total: null })).toBeUndefined();
    expect(percentOf({ done: 0, total: 0 })).toBeUndefined();
  });

  it('rounds down and never passes 100', () => {
    expect(percentOf({ done: 1, total: 3 })).toBe(33);
    expect(percentOf({ done: 5, total: 4 })).toBe(100);
  });
});

describe('overallPercent', () => {
  it('averages the running tasks that count, leaving out the others', () => {
    expect(
      overallPercent([
        task({ id: 'a', done: 1, total: 4 }),
        task({ id: 'b', done: 3, total: 4 }),
        task({ id: 'c' }),
        task({ id: 'd', status: 'done', done: 4, total: 4 }),
      ]),
    ).toBe(50);
  });

  it('is undefined when nothing counts', () => {
    expect(overallPercent([task({ id: 'a' })])).toBeUndefined();
  });
});

describe('ordered', () => {
  it('puts the running first, then the failed, then the done, keeping the order inside', () => {
    const list = ordered([
      task({ id: 'done', status: 'done' }),
      task({ id: 'r1' }),
      task({ id: 'failed', status: 'failed' }),
      task({ id: 'r2' }),
    ]);
    expect(list.map(({ id }) => id)).toEqual(['r1', 'r2', 'failed', 'done']);
  });
});

describe.each(['fr', 'en'] as const)('the words of a task (%s)', (locale) => {
  const t = createTranslator(locale);

  it('has a title for each code the server sends, and one for a code it does not know', () => {
    for (const code of [
      'scan',
      'transfer',
      'undo',
      'undo-check',
      'match',
      'tidy',
      'tidy-report',
      'backup',
      'vacuum',
      'empty-replaced',
      'send-collections',
      'something-new',
    ]) {
      expect(t(labelOf({ code }), { name: 'Films' })).not.toMatch(/^web\./);
    }
  });

  it('names the phase of a scan', () => {
    expect(phaseOf({ params: { phase: 'read' } })).toBe('web.library.progress.read');
    expect(phaseOf({ params: {} })).toBeUndefined();
    expect(phaseOf({ params: { phase: 'nope' } })).toBeUndefined();
  });
});
