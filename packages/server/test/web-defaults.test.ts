import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLD } from '@kinoshelf/core';

// The web does not import the core, so its copy of a default is held equal here.
describe('the defaults the web mirrors', () => {
  it('uses the core’s default threshold', async () => {
    const source = await readFile(
      new URL('../../web/src/lib/libraries.ts', import.meta.url),
      'utf8',
    );
    const mirrored = /THRESHOLD_DEFAULT = (\d+)/.exec(source)?.[1];
    expect(Number(mirrored)).toBe(DEFAULT_THRESHOLD);
  });
});
