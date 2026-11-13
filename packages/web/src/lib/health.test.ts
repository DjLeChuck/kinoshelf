import { describe, expect, it } from 'vitest';
import { stateOf, uptimeParts, worst, type HealthReport } from './health.js';

const report = (over: Partial<HealthReport> = {}): HealthReport => ({
  problems: [],
  server: { version: '1', uptimeSeconds: 0, node: 'v26', arch: 'linux-x64', configDir: '/c' },
  ffprobe: { version: '7.1' },
  database: {
    sizeBytes: 1,
    journalEntries: 0,
    cacheEntries: 0,
    migrations: { applied: 1, last: null },
  },
  disks: [],
  queue: {
    analyses: { running: 0, queued: 0 },
    transfers: { running: 0, queued: 0 },
    probes: 0,
    completeness: 0,
  },
  notify: { webhooks: 0, plex: false, jellyfin: false, recent: [] },
  ...over,
});

describe('stateOf', () => {
  it('is danger for an error and warn for a warning, on the card of the problem only', () => {
    const r = report({
      problems: [
        { area: 'disk', code: 'library-unreachable', severity: 'error' },
        { area: 'ffprobe', code: 'ffprobe-missing', severity: 'warn' },
      ],
    });
    expect(stateOf('disk', r, undefined)).toBe('danger');
    expect(stateOf('ffprobe', r, undefined)).toBe('warn');
    expect(stateOf('database', r, undefined)).toBe('ok');
  });

  it('leaves a card for something not configured neither good nor wrong', () => {
    const r = report();
    expect(stateOf('webhooks', r, undefined)).toBe('off');
    expect(stateOf('media', r, undefined)).toBe('off');
    expect(stateOf('media', report({ notify: { ...r.notify, plex: true } }), undefined)).toBe('ok');
    expect(stateOf('watch', r, { enabled: false } as never)).toBe('off');
  });
});

describe('worst', () => {
  it('takes the most serious, and ignores what is off', () => {
    expect(worst(['ok', 'off'])).toBe('ok');
    expect(worst(['ok', 'warn', 'off'])).toBe('warn');
    expect(worst(['warn', 'danger'])).toBe('danger');
  });
});

describe('uptimeParts', () => {
  it('splits seconds', () => {
    expect(uptimeParts(90_061)).toEqual({ days: 1, hours: 1, minutes: 1 });
    expect(uptimeParts(59)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });
});
