import { describe, expect, it } from 'vitest';
import { Validations } from '../src/lib/validations.svelte.js';

describe('Validations', () => {
  it('tells a running entry from the others and from one that never started', () => {
    const v = new Validations();
    v.start('a');
    expect(v.running('a')).toBe(true);
    expect(v.running('b')).toBe(false);
    expect(v.running(null)).toBe(false);
  });

  it('keeps a failure on its own entry until it is tried again or cleared', () => {
    const v = new Validations();
    const error = new Error('boom');
    v.start('a');
    v.fail('a', error);
    expect(v.running('a')).toBe(false);
    expect(v.failure('a')).toEqual({ error });
    expect(v.failure('b')).toBeUndefined();
    v.start('a');
    expect(v.failure('a')).toBeUndefined();
    v.clear('a');
    expect(v.running('a')).toBe(false);
  });

  it('looks over the entries of a group', () => {
    const v = new Validations();
    v.start('b');
    v.fail('c', 'x');
    expect(v.anyRunning(['a', null, 'b'])).toBe(true);
    expect(v.firstFailure(['a', 'c'])).toEqual({ error: 'x' });
  });
});
