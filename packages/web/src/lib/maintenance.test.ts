import { describe, expect, it } from 'vitest';
import { hasWork, tallyOf, type TidyTask } from './maintenance.js';

const task = (over: Partial<TidyTask> = {}): TidyTask => ({
  library: 'films',
  dryRun: true,
  status: 'done',
  phase: 'subtitles',
  done: 0,
  total: 0,
  current: null,
  startedAt: '2026-11-17T00:00:00Z',
  endedAt: null,
  folders: null,
  files: null,
  subtitles: null,
  error: null,
  ...over,
});

describe('tallyOf, subtitles', () => {
  it('counts what goes next to its video, what stays and what failed', () => {
    const tally = tallyOf(
      task({
        subtitles: {
          batch: null,
          items: [
            { path: '/a/Subs/2_French.srt', destination: '/a/Film.fr.srt', status: 'would-do' },
            { path: '/a/Subs/3.srt', destination: '/a/Film.en.srt', status: 'failed' },
            {
              path: '/a/Subs/4.srt',
              destination: '/a/Film.es.srt',
              status: 'skipped',
              reason: 'destination-exists',
            },
          ],
          left: [{ path: '/a/Subs/Film.srt', reason: 'language-unknown' }],
        },
      }),
    );
    expect(tally).toMatchObject({ subtitles: 1, subtitlesLeft: 1, failed: 1 });
  });

  it('is work to confirm only when something would move', () => {
    expect(hasWork(tallyOf(task()))).toBe(false);
    const onlyLeft = task({
      subtitles: { batch: null, items: [], left: [{ path: '/x', reason: 'language-taken' }] },
    });
    expect(hasWork(tallyOf(onlyLeft))).toBe(false);
    const toMove = task({
      subtitles: {
        batch: null,
        items: [{ path: '/x', destination: '/y', status: 'would-do' }],
        left: [],
      },
    });
    expect(hasWork(tallyOf(toMove))).toBe(true);
  });
});
