import { describe, expect, it } from 'vitest';
import type { LeftBehind, ReportOperation } from './library-items.js';
import { previewOf } from './run-preview.js';

const operation = (role: string, destination: string): ReportOperation => ({
  type: 'transfer',
  role,
  source: null,
  destination,
  status: 'done',
  error: null,
});

describe('previewOf', () => {
  it('carries what a file leaves behind, and nothing for one that leaves none', () => {
    const left: LeftBehind[] = [{ path: '/in/Subs/3_French.srt', reason: 'language-taken' }];
    const { items } = previewOf({
      items: [
        { entryId: 'a', results: [operation('main', '/lib/Dune/Dune.mkv')], leftBehind: left },
        { entryId: 'b', results: [operation('main', '/lib/Alien/Alien.mkv')] },
      ],
    });
    expect(items.map((item) => item.leftBehind)).toEqual([left, []]);
  });
});
