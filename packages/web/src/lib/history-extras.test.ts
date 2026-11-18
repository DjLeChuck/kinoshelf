import { describe, expect, it } from 'vitest';
import { extraLabelOf } from './history.js';

describe('extraLabelOf', () => {
  it('tells an NFO written again from an image changed', () => {
    expect(extraLabelOf({ kind: 'replaced', destination: '/m/Dune (2021)/movie.nfo' })).toBe(
      'replaced-nfo',
    );
    expect(extraLabelOf({ kind: 'replaced', destination: '/m/Dune (2021)/poster.jpg' })).toBe(
      'replaced',
    );
    expect(extraLabelOf({ kind: 'generated', destination: '/m/Dune (2021)/movie.nfo' })).toBe(
      'generated',
    );
  });
});
