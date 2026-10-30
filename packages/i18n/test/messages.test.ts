import { describe, expect, it } from 'vitest';
import { createTranslator } from '../src/index.js';

const en = createTranslator('en');
const fr = createTranslator('fr');

describe('counts in the messages', () => {
  it('agree with the number, in both languages', () => {
    expect(fr('web.home.todo.title', { count: 1 })).toBe('1 fichier attend votre validation');
    expect(fr('web.home.todo.title', { count: 3 })).toBe('3 fichiers attendent votre validation');
    expect(en('web.home.todo.title', { count: 1 })).toBe('1 file waiting for your validation');
    expect(en('web.home.todo.title', { count: 3 })).toBe('3 files waiting for your validation');
  });

  it('keeps a count that was cut short, as the queue does past its limit', () => {
    expect(fr('web.home.todo.title', { count: '200+' })).toBe(
      '200+ fichiers attendent votre validation',
    );
  });

  it('agrees every count of a sentence on its own', () => {
    const params = { count: 2, path: '/in', ambiguous: 0, unrecognized: 1, conflict: 3 };
    expect(fr('notify.review.message', params)).toBe(
      '2 fichiers de /in attendent une décision : 0 ambigu, 1 non reconnu, 3 en conflit.',
    );
    expect(fr('notify.review.message', { ...params, count: 1 })).toBe(
      '1 fichier de /in attend une décision : 0 ambigu, 1 non reconnu, 3 en conflit.',
    );
    expect(en('notify.review.message', { ...params, count: 1 })).toBe(
      '1 file of /in needs a decision: 0 ambiguous, 1 unrecognized, 3 in conflict.',
    );
  });

  it('writes a zero in French as the singular, an exact `=0` aside', () => {
    expect(fr('web.queue.sources.pending', { count: 0 })).toBe(
      '0 release en cours d’écriture ou de stabilisation.',
    );
    expect(en('web.queue.sources.pending', { count: 0 })).toBe(
      '0 releases still being written or settling.',
    );
  });
});
