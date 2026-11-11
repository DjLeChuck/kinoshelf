import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '@kinoshelf/core';
import { join } from 'node:path';
import { SqliteJournal } from '@kinoshelf/core';
import { SqliteHttpCache } from '@kinoshelf/provider-tmdb';
import { buildApp } from '../src/app.js';
import { migrated } from '../src/database.js';
import { forgetReplacedScans, purgeHistory } from '../src/purge.js';
import { cleanup, harness, makeDir, put, track } from './harness.js';

afterEach(cleanup);

const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-10-28T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

function setup() {
  const database = migrated(new Database(':memory:'));
  let entryCount = 0;
  const job = (id: string, status: string, ageDays: number) =>
    database
      .prepare(
        'INSERT INTO jobs (id, path, status, created_at, finished_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        id,
        `/${id}`,
        status,
        daysAgo(ageDays + 1),
        status === 'queued' ? null : daysAgo(ageDays),
      );
  const entry = (jobId: string, classification: string, resolution: string | null) =>
    database
      .prepare(
        `INSERT INTO job_entries (id, job_id, path, classification, resolution, parsed, outcome)
         VALUES (?, ?, ?, ?, ?, '{}', '{}')`,
      )
      .run(`e${++entryCount}`, jobId, `/f${entryCount}`, classification, resolution);
  const execution = (jobId: string, status: string) =>
    database
      .prepare("INSERT INTO executions (id, job_id, status, created_at) VALUES (?, ?, ?, 'x')")
      .run(`x-${jobId}-${status}`, jobId, status);
  const jobsLeft = (): string[] =>
    database
      .prepare<[], { id: string }>('SELECT id FROM jobs ORDER BY id')
      .all()
      .map((row) => row.id);
  const count = (table: string): number =>
    (database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const purge = (days = 30) => purgeHistory(database, { olderThanDays: days, now: () => NOW });
  return { database, job, entry, execution, jobsLeft, count, purge };
}

describe('purgeHistory', () => {
  it('forgets an old finished job with everything settled, with its files and transfers', () => {
    const { job, entry, execution, jobsLeft, count, purge } = setup();
    job('old', 'done', 60);
    entry('old', 'to-rename', 'done');
    entry('old', 'unrecognized', 'ignored');
    entry('old', 'compliant', null);
    execution('old', 'done');

    expect(purge()).toEqual({ jobs: 1, entries: 3, executions: 1 });
    expect(jobsLeft()).toEqual([]);
    expect(count('job_entries')).toBe(0);
    expect(count('executions')).toBe(0);
  });

  it('forgets an old job whose analysis failed', () => {
    const { job, jobsLeft, purge } = setup();
    job('failed', 'failed', 60);
    expect(purge().jobs).toBe(1);
    expect(jobsLeft()).toEqual([]);
  });

  it('keeps a recent job, whatever its state', () => {
    const { job, entry, jobsLeft, purge } = setup();
    job('recent', 'done', 5);
    entry('recent', 'to-rename', 'done');
    expect(purge()).toEqual({ jobs: 0, entries: 0, executions: 0 });
    expect(jobsLeft()).toEqual(['recent']);
  });

  it.each([
    ['an unrecognized file nobody decided on', 'unrecognized', null],
    ['an ambiguous file', 'ambiguous', null],
    ['a conflict', 'conflict', null],
    ['a match not transferred yet', 'to-rename', null],
    ['a transfer that failed', 'to-rename', 'failed'],
  ])(
    'keeps an old job that still has %s: it is the validation queue',
    (_name, classification, resolution) => {
      const { job, entry, jobsLeft, count, purge } = setup();
      job('open', 'done', 400);
      entry('open', 'to-rename', 'done');
      entry('open', classification, resolution);

      expect(purge()).toEqual({ jobs: 0, entries: 0, executions: 0 });
      expect(jobsLeft()).toEqual(['open']);
      expect(count('job_entries')).toBe(2);
    },
  );

  it.each([['queued'], ['running']])('keeps an old job with a %s transfer', (status) => {
    const { job, entry, execution, jobsLeft, purge } = setup();
    job('busy', 'done', 400);
    entry('busy', 'to-rename', 'done');
    execution('busy', status);
    expect(purge().jobs).toBe(0);
    expect(jobsLeft()).toEqual(['busy']);
  });

  it.each([['queued'], ['running']])('keeps a job that is %s, however old', (status) => {
    const { job, jobsLeft, purge } = setup();
    job('waiting', status, 400);
    expect(purge().jobs).toBe(0);
    expect(jobsLeft()).toEqual(['waiting']);
  });

  it('keeps the other jobs when it forgets one', () => {
    const { job, entry, jobsLeft, count, purge } = setup();
    job('a-old', 'done', 90);
    entry('a-old', 'to-rename', 'done');
    job('b-open', 'done', 90);
    entry('b-open', 'unrecognized', null);
    job('c-recent', 'done', 1);
    entry('c-recent', 'to-rename', 'done');

    expect(purge().jobs).toBe(1);
    expect(jobsLeft()).toEqual(['b-open', 'c-recent']);
    expect(count('job_entries')).toBe(2);
  });

  it('does not touch the journal: a forgotten batch stays undoable', () => {
    const { database, job, entry, purge } = setup();
    const journal = new SqliteJournal(database);
    job('old', 'done', 90);
    entry('old', 'to-rename', 'done');
    journal.record({
      kind: 'transfer',
      id: 'j1',
      batchId: 'b1',
      source: '/s',
      destination: '/d',
      mode: 'copy',
      createdDirectories: [],
      at: 'x',
    });

    expect(purge().jobs).toBe(1);
    expect(journal.entriesOf('b1')).toHaveLength(1);
    expect(journal.lastBatchId()).toBe('b1');
  });

  it.each([[0], [-5], [Number.NaN]])('keeps everything with a retention of %s', (days) => {
    const { job, jobsLeft, purge } = setup();
    job('old', 'done', 4000);
    expect(purge(days).jobs).toBe(0);
    expect(jobsLeft()).toEqual(['old']);
  });
});

describe('replaced scans', () => {
  const SCANS = [{ libraryId: 'films', source: '/films' }];

  /** Scans in the order given (the queue's order), each with an unrecognized file nobody settled. */
  function scans() {
    const t = setup();
    const scan = (
      id: string,
      status: string,
      ageDays: number,
      libraryId = 'films',
      path = '/films',
    ) => {
      t.database
        .prepare(
          'INSERT INTO jobs (id, path, library_id, status, created_at, finished_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, path, libraryId, status, daysAgo(ageDays + 1), daysAgo(ageDays));
      t.entry(id, 'unrecognized', null);
    };
    const snapshotOf = (jobId: string) =>
      t.database
        .prepare(
          "INSERT INTO library_items (library_id, path, state, scan_job_id, scanned_at) VALUES ('films', ?, 'ok', ?, 'x')",
        )
        .run(`/films/${jobId}.mkv`, jobId);
    return { ...t, scan, snapshotOf };
  }

  it('forgets at once the scans a later one replaced, with their files left undecided', () => {
    const { scan, snapshotOf, jobsLeft, count, database } = scans();
    scan('a-first', 'done', 2);
    scan('b-failed', 'failed', 1);
    scan('c-latest', 'done', 0);
    snapshotOf('c-latest');

    expect(forgetReplacedScans(database, SCANS)).toEqual({ jobs: 2, entries: 2, executions: 0 });
    expect(jobsLeft()).toEqual(['c-latest']);
    expect(count('job_entries')).toBe(1);
  });

  it('keeps the latest scan, one that is still running after it, and a failed one after it', () => {
    const { scan, jobsLeft, database } = scans();
    scan('a-done', 'done', 3);
    scan('b-failed', 'failed', 2);
    expect(forgetReplacedScans(database, SCANS).jobs).toBe(0);

    scan('c-running', 'running', 0);
    expect(forgetReplacedScans(database, SCANS).jobs).toBe(0);
    expect(jobsLeft()).toEqual(['a-done', 'b-failed', 'c-running']);
  });

  it("keeps what is not a scan of a typed library's whole source", () => {
    const { scan, jobsLeft, database } = scans();
    scan('a-release', 'done', 3, 'films', '/films/Some.Release');
    scan('b-arrivals', 'done', 3, 'downloads', '/downloads');
    scan('c-release', 'done', 2, 'films', '/films/Some.Release');
    scan('d-arrivals', 'done', 2, 'downloads', '/downloads');
    scan('e-films', 'done', 1);

    expect(forgetReplacedScans(database, SCANS).jobs).toBe(0);
    expect(forgetReplacedScans(database, []).jobs).toBe(0);
    expect(jobsLeft()).toHaveLength(5);
  });

  it('keeps a replaced scan the snapshot still points at', () => {
    const { scan, snapshotOf, jobsLeft, database } = scans();
    scan('a-old', 'done', 2);
    snapshotOf('a-old');
    scan('b-new', 'done', 1);

    expect(forgetReplacedScans(database, SCANS).jobs).toBe(0);
    expect(jobsLeft()).toEqual(['a-old', 'b-new']);
  });

  it('leaves a replaced scan that made a batch to the retention, then forgets it', () => {
    const { scan, execution, jobsLeft, database, purge } = scans();
    scan('a-old', 'done', 60);
    execution('a-old', 'done');
    scan('b-new', 'done', 1);

    expect(forgetReplacedScans(database, SCANS).jobs).toBe(0);
    expect(purge().jobs).toBe(0); // no `scans`: its undecided file keeps it
    expect(purgeHistory(database, { olderThanDays: 30, now: () => NOW, scans: SCANS })).toEqual({
      jobs: 1,
      entries: 1,
      executions: 1,
    });
    expect(jobsLeft()).toEqual(['b-new']);
  });

  it('still keeps a replaced scan with a transfer under way', () => {
    const { scan, execution, jobsLeft, database } = scans();
    scan('a-old', 'done', 60);
    execution('a-old', 'running');
    scan('b-new', 'done', 1);

    expect(purgeHistory(database, { olderThanDays: 30, now: () => NOW, scans: SCANS }).jobs).toBe(
      0,
    );
    expect(jobsLeft()).toEqual(['a-old', 'b-new']);
  });
});

describe('the purge of a running server', () => {
  const oldJob = (database: Database) =>
    database
      .prepare(
        "INSERT INTO jobs (id, path, status, created_at, finished_at) VALUES ('old', '/old', 'done', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')",
      )
      .run();
  const jobCount = (database: Database) =>
    (database.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n;
  const options = (database: Database) => ({
    version: '1',
    config: {},
    configDir: '/nonexistent',
    database,
    env: {},
  });

  it('forgets old history when it starts, and only if a retention is set', async () => {
    const kept = migrated(new Database(':memory:'));
    oldJob(kept);
    track(await buildApp(options(kept)));
    expect(jobCount(kept)).toBe(1);

    const purged = migrated(new Database(':memory:'));
    oldJob(purged);
    track(await buildApp({ ...options(purged), retentionDays: 30 }));
    expect(jobCount(purged)).toBe(0);
  });

  it('forgets the expired TMDB answers when it starts, whatever the retention', async () => {
    const database = migrated(new Database(':memory:'));
    const cache = new SqliteHttpCache(database);
    cache.set('old', { status: 200, body: '{}' }, Date.now() - 1000);
    cache.set('fresh', { status: 200, body: '{}' }, Date.now() + 60_000);
    track(await buildApp(options(database)));
    expect(
      database
        .prepare<[], { key: string }>('SELECT key FROM tmdb_http_cache')
        .all()
        .map((row) => row.key),
    ).toEqual(['fresh']);
  });

  it('forgets the scan a new one of the same library replaced, once it ends', async () => {
    const source = await makeDir();
    await put(join(source, 'Mystery.Home.Video.mkv'));
    const h = await harness({
      retentionDays: 30,
      config: { libraries: [{ id: 'films', name: 'Films', source, type: 'movie' }] },
    });
    const scan = async () => {
      const id = (await h.request('POST', '/api/libraries/films/scan')).json<{ id: string }>().id;
      await h.app.jobs.idle();
      return id;
    };
    const first = await scan();
    const second = await scan();

    const left = h.database
      .prepare<[], { id: string }>('SELECT id FROM jobs')
      .all()
      .map((row) => row.id);
    expect(left).toEqual([second]);
    expect(left).not.toContain(first);
  });

  it('forgets again every day while it runs', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const database = migrated(new Database(':memory:'));
      track(await buildApp({ ...options(database), retentionDays: 30 }));
      oldJob(database); // finished long ago, after the start-up pass
      expect(jobCount(database)).toBe(1);

      vi.advanceTimersByTime(86_400_000);
      expect(jobCount(database)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
