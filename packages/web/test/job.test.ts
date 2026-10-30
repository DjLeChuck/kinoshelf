import { describe, expect, it } from 'vitest';
import { followUp, formatDuration, settingsDrift, shortId, total } from '../src/lib/job.js';

const frozen = { profile: 'plex', mode: 'hardlink', destinationRoot: '/tank/media' } as const;
const none = { profile: null, mode: null, threshold: null, destination: null };

describe('settingsDrift', () => {
  it('reports nothing when the settings are the same', () => {
    expect(
      settingsDrift(frozen, {
        ...none,
        profile: 'plex',
        mode: 'hardlink',
        destination: '/tank/media',
      }),
    ).toEqual([]);
  });

  it('does not compare a setting that is not configured: its default is unknown here', () => {
    expect(settingsDrift(frozen, none)).toEqual([]);
  });

  it('flags the mode and the profile that changed, with their value today', () => {
    expect(settingsDrift(frozen, { ...none, profile: 'jellyfin', mode: 'copy' })).toEqual([
      { field: 'profile', now: 'jellyfin' },
      { field: 'mode', now: 'copy' },
    ]);
  });

  it('compares one root with a root per kind', () => {
    expect(
      settingsDrift(frozen, {
        ...none,
        destination: { movies: '/tank/media', series: '/tank/tv' },
      }),
    ).toEqual([{ field: 'series', now: '/tank/tv' }]);
    expect(
      settingsDrift(
        { ...frozen, destinationRoot: { movie: '/a', series: '/b' } },
        { ...none, destination: { movies: '/a', series: '/b' } },
      ),
    ).toEqual([]);
  });
});

describe('followUp', () => {
  it('points a transferred file to its batch', () => {
    expect(followUp({ classification: 'to-rename', resolution: 'done', batchId: 'b1' })).toEqual({
      href: '/history/b1',
      kind: 'batch',
    });
  });

  it('points what waits for an answer, or failed, to the queue', () => {
    expect(followUp({ classification: 'ambiguous', resolution: null })).toEqual({
      href: '/queue',
      kind: 'queue',
    });
    expect(followUp({ classification: 'to-rename', resolution: 'failed' })?.kind).toBe('queue');
  });

  it('has no next step for a file that is in order or set aside', () => {
    expect(followUp({ classification: 'compliant', resolution: null })).toBeUndefined();
    expect(followUp({ classification: 'unrecognized', resolution: 'ignored' })).toBeUndefined();
  });
});

describe('formatting', () => {
  it('shortens an id to its first block', () => {
    expect(shortId('3f2a9c1e-7b64-4d0a-9e51-0c8f2b7a6d11')).toBe('3f2a9c1e');
  });

  it('says how long a job took, at least one second', () => {
    expect(formatDuration('2026-10-27T09:08:41Z', '2026-10-27T09:08:41.200Z')).toBe('1 s');
    expect(formatDuration('2026-10-27T09:08:41Z', '2026-10-27T09:09:53Z')).toBe('1 min 12 s');
    expect(formatDuration('2026-10-27T09:08:41Z', 'nope')).toBeUndefined();
  });

  it('counts every file of a summary', () => {
    expect(
      total({ compliant: 3, 'to-rename': 2, conflict: 1, ambiguous: 0, unrecognized: 4 }),
    ).toBe(10);
    expect(total(null)).toBe(0);
  });
});
