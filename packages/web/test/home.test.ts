import { describe, expect, it } from 'vitest';
import type { BatchSummary } from '../src/lib/history.js';
import {
  activeJobs,
  activityOf,
  failureCount,
  queueLabel,
  recentFailure,
  servicesOf,
  suggestsServer,
  unresolvedFailures,
  weekCount,
  type JobSummary,
} from '../src/lib/home.js';
import { allSettled, nextStep, settled, type Step } from '../src/lib/onboarding.js';
import type { Settings } from '../src/lib/settings.js';

const NOW = Date.parse('2026-10-30T12:00:00Z');
const DAY = 24 * 3600 * 1000;

const batch = (
  daysAgo: number,
  status: BatchSummary['status'],
  id = String(daysAgo),
): BatchSummary => ({
  id,
  at: new Date(NOW - daysAgo * DAY).toISOString(),
  status,
  operations: 3,
  modes: ['copy'],
  failed: status === 'failed' ? 1 : 0,
  origin: null,
  error: null,
});

const step = (id: Step['id'], state: Step['state']): Step => ({ id, state, auto: false });

describe('home figures', () => {
  const batches = [batch(1, 'failed'), batch(2, 'done'), batch(6, 'done'), batch(9, 'done')];

  it('counts the batches that moved files in the last seven days', () => {
    expect(weekCount(batches, NOW)).toBe(2);
  });

  it('finds the latest failure of the week, not an older one', () => {
    expect(recentFailure(batches, NOW)?.id).toBe('1');
    expect(recentFailure([batch(9, 'failed')], NOW)).toBeUndefined();
    expect(failureCount(batches, NOW)).toBe(1);
  });

  it('says how a batch ended and how many files it touched', () => {
    expect(activityOf(batch(1, 'undone'))).toEqual({ key: 'web.home.activity.undone', count: 3 });
  });

  it('marks a cut-short queue count', () => {
    expect(queueLabel(3)).toBe('3');
    expect(queueLabel(200)).toBe('200+');
  });
});

describe('services', () => {
  const settings = {
    tmdb: { configured: true },
    plex: { url: 'http://plex' },
    jellyfin: null,
    watch: { folders: [] },
  } as unknown as Settings;

  it('reports each as configured or not, an empty watch list being off', () => {
    expect(servicesOf(settings)).toEqual([
      { id: 'tmdb', on: true },
      { id: 'plex', on: true },
      { id: 'jellyfin', on: false },
      { id: 'watch', on: false },
    ]);
  });

  it('suggests a player only when none is connected', () => {
    expect(suggestsServer(settings)).toBe(false);
    expect(suggestsServer({ ...settings, plex: null })).toBe(true);
  });
});

describe('setup steps', () => {
  const steps = [step('tmdb', 'done'), step('server', 'skipped'), step('destination', 'todo')];

  it('counts a skipped step as settled and points at the first open one', () => {
    expect(settled(steps)).toBe(2);
    expect(nextStep(steps)).toBe('destination');
    expect(allSettled(steps)).toBe(false);
    expect(allSettled(steps.map((s) => ({ ...s, state: 'done' as const })))).toBe(true);
  });
});

const job = (path: string, status: JobSummary['status'], id = `${path}-${status}`): JobSummary => ({
  id,
  path,
  status,
  apply: false,
  createdAt: '2026-10-30T09:00:00Z',
  finishedAt: null,
  error: status === 'failed' ? { code: 'discover.not-found' } : null,
});

describe('analyses on the home page', () => {
  it('lists the ones not over yet', () => {
    const jobs = [
      job('/a', 'running'),
      job('/b', 'queued'),
      job('/c', 'done'),
      job('/d', 'failed'),
    ];
    expect(activeJobs(jobs).map((j) => j.path)).toEqual(['/a', '/b']);
  });

  it('keeps a failure, however early it failed', () => {
    expect(unresolvedFailures([job('/gone', 'failed')]).map((j) => j.path)).toEqual(['/gone']);
  });

  it('drops a failure once the same path was sent again and did not fail', () => {
    // Newest first: the retry is ahead of the failure it answers.
    const jobs = [job('/a', 'done'), job('/b', 'failed'), job('/a', 'failed', 'old')];
    expect(unresolvedFailures(jobs).map((j) => j.path)).toEqual(['/b']);
  });

  it('lets a retry still working speak for its path', () => {
    const jobs = [job('/a', 'running'), job('/a', 'failed')];
    expect(unresolvedFailures(jobs)).toEqual([]);
  });

  it('shows a path once when the retry failed too, with the newest failure', () => {
    const jobs = [job('/a', 'failed', 'new'), job('/a', 'failed', 'old')];
    expect(unresolvedFailures(jobs).map((j) => j.id)).toEqual(['new']);
  });
});
