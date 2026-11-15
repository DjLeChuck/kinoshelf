import { writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '@kinoshelf/core';
import { LogStore } from '../src/logs.js';
import { DatabaseTasks } from '../src/database-tasks.js';
import { ReplacedFiles } from '../src/replaced-files.js';
import { ProgressTracker } from '../src/progress.js';
import { cleanup, harness, makeDir, put, type Harness } from './harness.js';

afterEach(cleanup);

const silent = { info: () => undefined, warn: () => undefined };

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/** A movie library with a renamed folder and the folder another tool left beside it. */
async function setup() {
  const source = await makeDir();
  const configDir = await makeDir();
  await put(join(source, 'Dune (2021)', 'Dune (2021).mkv'), 'video');
  await put(join(source, 'Dune (2021)', 'Dune (2021)-poster.jpg'), 'poster');
  await put(join(source, 'Dune (2021)', 'Dune (2021).nfo'), 'nfo');
  await put(join(source, 'Dune (2021)', 'movie.nfo'), 'ours');
  await put(join(source, 'Dune (2021) - 1080p', 'Dune (2021)-fanart.jpg'), 'fanart');
  await put(join(source, 'Alien (1979)', 'movie.nfo'), 'alone');
  const h = await harness({
    configDir,
    config: {
      libraries: [
        { id: 'films', name: 'Films', source, type: 'movie' },
        { id: 'shows', name: 'Shows', source: await makeDir(), type: 'series' },
      ],
    },
  });
  return { h, source, configDir };
}

interface Task {
  status: string;
  dryRun: boolean;
  phase: string;
  folders: { batch: string | null; items: Record<string, unknown>[] } | null;
  files: { batch: string | null; items: Record<string, unknown>[] } | null;
  error: { code: string } | null;
}

/** Starts a tidy-up and waits for its task to end, as the web follows it. */
async function tidy(h: Harness, body: object): Promise<Task> {
  const started = await h.request('POST', '/api/maintenance/tidy', body);
  expect(started.statusCode).toBe(202);
  return finished(h, (body as { library: string }).library);
}

async function finished(h: Harness, library: string): Promise<Task> {
  for (;;) {
    const { tasks } = (await h.request('GET', '/api/maintenance/tidy')).json<{
      tasks: (Task & { library: string })[];
    }>();
    const task = tasks.find((candidate) => candidate.library === library);
    if (task && task.status !== 'running') {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('POST /api/maintenance/tidy: a report', () => {
  it('answers at once with a running task, then reports what a tidy-up would do and moves nothing', async () => {
    const { h, source } = await setup();

    const started = await h.request('POST', '/api/maintenance/tidy', {
      library: 'films',
      dryRun: true,
    });
    expect(started.statusCode).toBe(202);
    expect(started.json<Task>()).toMatchObject({ status: 'running', dryRun: true });

    const task = await finished(h, 'films');
    expect(task.status).toBe('done');
    expect(task.folders?.items).toMatchObject([
      { path: join(source, 'Alien (1979)'), status: 'skipped', reason: 'no-twin' },
      { path: join(source, 'Dune (2021) - 1080p'), status: 'would-remove', files: 1 },
    ]);
    expect(task.files?.items).toMatchObject([
      { kind: 'poster', action: 'rename', status: 'would-do', counterpart: 'poster.jpg' },
      { kind: 'nfo', status: 'skipped', reason: 'nfo-not-requested' },
    ]);
    expect(task.folders?.batch).toBeNull();
    expect(await exists(join(source, 'Dune (2021) - 1080p'))).toBe(true);
    expect(h.database.prepare('SELECT 1 FROM journal_entries').get()).toBeUndefined();
  });

  it('has no task for a library nobody tidied', async () => {
    const { h } = await setup();

    expect((await h.request('GET', '/api/maintenance/tidy')).json()).toEqual({ tasks: [] });
  });

  it('gives a series library no foreign file to look at', async () => {
    const { h } = await setup();

    const task = await tidy(h, { library: 'shows', dryRun: true });

    expect(task.files).toBeNull();
  });
});

describe('POST /api/maintenance/tidy: a run', () => {
  it('sets the folder aside and renames the image, one batch each, and undo puts it all back', async () => {
    const { h, source } = await setup();

    const task = await tidy(h, { library: 'films' });

    expect(task.status).toBe('done');
    const folders = task.folders?.batch ?? null;
    const files = task.files?.batch ?? null;
    expect(folders).not.toBeNull();
    expect(files).not.toBeNull();
    expect(await exists(join(source, 'Dune (2021) - 1080p'))).toBe(false);
    expect(await exists(join(source, 'Dune (2021)', 'poster.jpg'))).toBe(true);
    // The NFO is left unless asked.
    expect(await exists(join(source, 'Dune (2021)', 'Dune (2021).nfo'))).toBe(true);

    const detail = (await h.request('GET', `/api/batches/${folders ?? ''}`)).json<{
      extras: { kind: string }[];
    }>();
    expect(detail.extras).toMatchObject([{ kind: 'removed' }]);

    for (const batch of [files, folders]) {
      expect((await h.undo(batch ?? '', {})).statusCode).toBe(200);
    }
    expect(
      await readFile(join(source, 'Dune (2021) - 1080p', 'Dune (2021)-fanart.jpg'), 'utf8'),
    ).toBe('fanart');
    expect(await exists(join(source, 'Dune (2021)', 'Dune (2021)-poster.jpg'))).toBe(true);
  });

  it('leaves the NFO aside only when asked', async () => {
    const { h, source } = await setup();

    await tidy(h, { library: 'films', folders: false, nfo: true });

    expect(await exists(join(source, 'Dune (2021)', 'Dune (2021).nfo'))).toBe(false);
    expect(await readFile(join(source, 'Dune (2021)', 'movie.nfo'), 'utf8')).toBe('ours');
  });

  it('refuses to do nothing', async () => {
    const { h } = await setup();

    const response = await h.request('POST', '/api/maintenance/tidy', {
      library: 'films',
      folders: false,
      files: false,
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a second tidy-up of the library while one runs', async () => {
    const { h } = await setup();
    expect(
      (await h.request('POST', '/api/maintenance/tidy', { library: 'films' })).statusCode,
    ).toBe(202);

    const second = await h.request('POST', '/api/maintenance/tidy', { library: 'films' });

    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: { code: 'maintenance.in-progress' } });
    await finished(h, 'films');
  });

  it('refuses while a scan of the library is queued', async () => {
    const { h, source } = await setup();
    expect((await h.request('POST', '/api/libraries/films/scan')).statusCode).toBe(202);

    const response = await h.request('POST', '/api/maintenance/tidy', { library: 'films' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: 'library.scan-in-progress' } });
    expect(await exists(join(source, 'Dune (2021) - 1080p'))).toBe(true);
  });

  it('answers 404 for an unknown library', async () => {
    const { h } = await setup();

    expect((await h.request('POST', '/api/maintenance/tidy', { library: 'nope' })).statusCode).toBe(
      404,
    );
  });

  it('keeps the failure in the task when the library cannot be read', async () => {
    const { h, source } = await setup();
    await rm(source, { recursive: true });

    const task = await tidy(h, { library: 'films', dryRun: true });

    expect(task.status).toBe('failed');
    expect(task.error?.code).toBe('discover.not-found');
  });
});

describe('GET /api/maintenance and POST /api/maintenance/purge-hidden', () => {
  it('counts the hidden analyses, forgets them on request, and says what the TMDB cache holds', async () => {
    const { h } = await setup();
    h.database
      .prepare(
        "INSERT INTO jobs (id, path, status, created_at, finished_at) VALUES ('j1', '/x', 'done', 'a', 'b')",
      )
      .run();

    const before = (await h.request('GET', '/api/maintenance')).json<{
      hiddenAnalyses: number;
      tmdbCache: { entries: number; bytes: number };
    }>();
    expect(before.hiddenAnalyses).toBe(1);
    expect(typeof before.tmdbCache.entries).toBe('number');
    expect(typeof before.tmdbCache.bytes).toBe('number');

    const purged = await h.request('POST', '/api/maintenance/purge-hidden');
    expect(purged.statusCode).toBe(200);
    expect(purged.json()).toEqual({ removed: 1 });
    expect(
      (await h.request('GET', '/api/maintenance')).json<{ hiddenAnalyses: number }>()
        .hiddenAnalyses,
    ).toBe(0);
  });
});

interface DbTask {
  kind: string;
  status: string;
  backup: { file: { name: string; bytes: number }; removed: number } | null;
  size: { before: number; after: number } | null;
  error: { code: string } | null;
}

async function databaseTask(h: Harness, kind: 'backup' | 'vacuum'): Promise<DbTask> {
  for (;;) {
    const { databaseTasks } = (await h.request('GET', '/api/maintenance')).json<{
      databaseTasks: DbTask[];
    }>();
    const task = databaseTasks.find((candidate) => candidate.kind === kind);
    if (task && task.status !== 'running') {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('database backup and compaction', () => {
  it('backs the database up to a file that holds the same data, and keeps only the newest ones', async () => {
    const { h, configDir } = await setup();
    h.database
      .prepare(
        "INSERT INTO jobs (id, path, status, created_at, finished_at) VALUES ('kept', '/x', 'done', 'a', 'b')",
      )
      .run();
    // Older copies than any made now, so the rotation has something to remove.
    const dir = join(configDir, 'backups');
    await mkdir(dir, { recursive: true });
    for (const day of ['20200101', '20200102', '20200103']) {
      await writeFile(join(dir, `kinoshelf-${day}-0000.sqlite`), 'old');
    }
    await h.request('PATCH', '/api/settings', { retention: { backupKeep: 2 } });

    const started = await h.request('POST', '/api/maintenance/backup');
    expect(started.statusCode).toBe(202);
    const task = await databaseTask(h, 'backup');

    expect(task.status).toBe('done');
    expect(task.backup?.removed).toBe(2);
    expect(await readdir(dir)).toHaveLength(2);
    expect(await readdir(dir)).toContain('kinoshelf-20200103-0000.sqlite');
    const copy = new Database(join(dir, task.backup?.file.name ?? ''));
    expect(copy.prepare("SELECT id FROM jobs WHERE id = 'kept'").get()).toEqual({ id: 'kept' });
    copy.close();
    expect(
      (await h.request('GET', '/api/maintenance')).json<{ backups: unknown[] }>().backups,
    ).toHaveLength(2);
  });

  it('compacts the database without changing its data, and refuses a second task meanwhile', async () => {
    const { h } = await setup();
    h.database
      .prepare(
        "INSERT INTO jobs (id, path, status, created_at, finished_at) VALUES ('kept', '/x', 'done', 'a', 'b')",
      )
      .run();

    // Pages freed by a deletion: what a compaction gives back.
    h.database.exec(
      'CREATE TABLE bulk (x BLOB); INSERT INTO bulk SELECT zeroblob(4000) FROM (WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 300) SELECT i FROM n); DROP TABLE bulk;',
    );

    expect((await h.request('POST', '/api/maintenance/vacuum')).statusCode).toBe(202);
    const refused = await h.request('POST', '/api/maintenance/backup');
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: { code: 'maintenance.database-task-running' } });

    const task = await databaseTask(h, 'vacuum');
    expect(task.status).toBe('done');
    expect(task.size?.after).toBeLessThan(task.size?.before ?? 0);
    expect(h.database.prepare("SELECT id FROM jobs WHERE id = 'kept'").get()).toEqual({
      id: 'kept',
    });
  });

  it('refuses to compact while a scan or a transfer runs', () => {
    const tasks = new DatabaseTasks({
      log: silent,
      database: new Database(':memory:'),
      configDir: '/nowhere',
      progress: new ProgressTracker(() => undefined),
      busy: () => true,
      keep: () => 3,
    });
    expect(() => tasks.startVacuum()).toThrow(
      expect.objectContaining({ code: 'maintenance.busy' }),
    );
  });
});

interface Replaced {
  replaced: {
    files: number;
    bytes: number;
    days: number;
    due: { files: number; bytes: number; batches: number };
  };
  replacedTask: {
    status: string;
    all: boolean;
    freed: { files: number; bytes: number; batches: number; failed: number } | null;
  } | null;
}

async function emptied(h: Harness, body: object): Promise<NonNullable<Replaced['replacedTask']>> {
  const started = await h.request('POST', '/api/maintenance/empty-replaced', body);
  expect(started.statusCode).toBe(202);
  for (;;) {
    const { replacedTask } = (await h.request('GET', '/api/maintenance')).json<Replaced>();
    if (replacedTask && replacedTask.status !== 'running') {
      return replacedTask;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('POST /api/maintenance/empty-replaced', () => {
  it('deletes the files set aside for good, and an undo then skips them instead of failing', async () => {
    const { h, configDir, source } = await setup();
    const task = await tidy(h, { library: 'films', files: false });
    const batch = task.folders?.batch ?? '';
    const dir = join(configDir, 'replaced');
    expect(await readdir(dir)).toHaveLength(1);

    // Just set aside: nothing is due under the 30 days, so a plain emptying deletes nothing.
    const figures = (await h.request('GET', '/api/maintenance')).json<Replaced>().replaced;
    expect(figures).toMatchObject({ files: 1, days: 30, due: { files: 0, batches: 0 } });
    expect((await emptied(h, {})).freed).toMatchObject({ files: 0 });
    expect(await readdir(dir)).toHaveLength(1);

    const everything = await emptied(h, { all: true });
    expect(everything.freed).toEqual({ files: 1, bytes: 6, batches: 1, failed: 0 });
    expect(await readdir(dir)).toHaveLength(0);

    const undone = (await h.undo(batch, {})).json<unknown>();
    expect(JSON.stringify(undone)).toContain('undo.backup-missing');
    // The folder did not come back: the file is gone for good, and nothing broke.
    expect(await exists(join(source, 'Dune (2021) - 1080p'))).toBe(false);
  });

  it('keeps what is younger than the retention, and names the batches that would lose a file', async () => {
    const { h, configDir } = await setup();
    await h.request('PATCH', '/api/settings', { retention: { replacedRetentionDays: 10 } });
    const dir = join(configDir, 'replaced');
    await mkdir(dir, { recursive: true });
    const aged = (name: string, daysAgo: number, batch: string | null): void => {
      const path = join(dir, name);
      writeFileSync(path, 'bytes');
      if (batch !== null) {
        h.database
          .prepare(
            `INSERT INTO journal_entries (id, batch_id, source, destination, mode, kind, at, created_directories, backup)
             VALUES (?, ?, '/s', '/d', '', 'replaced', ?, '[]', ?)`,
          )
          .run(name, batch, new Date(Date.now() - daysAgo * 86_400_000).toISOString(), path);
      }
    };
    aged('old.jpg', 40, 'batch-old');
    aged('recent.jpg', 2, 'batch-recent');

    const { replaced } = (await h.request('GET', '/api/maintenance')).json<Replaced>();
    expect(replaced.due).toEqual({ files: 1, bytes: 5, batches: 1 });

    const task = await emptied(h, {});
    expect(task.freed).toMatchObject({ files: 1, batches: 1 });
    expect(await readdir(dir)).toEqual(['recent.jpg']);
  });

  it('refuses while a scan, a transfer or an undo runs', () => {
    const files = new ReplacedFiles({
      log: silent,
      database: new Database(':memory:'),
      dir: '/nowhere',
      progress: new ProgressTracker(() => undefined),
      busy: () => true,
      days: () => 30,
    });
    expect(() => files.start({ all: true })).toThrow(
      expect.objectContaining({ code: 'maintenance.replaced-busy' }),
    );
  });
});

describe('the log of the maintenance actions', () => {
  it('records what each action did under the maintenance component', async () => {
    const configDir = await makeDir();
    const h = await harness({ configDir, logs: new LogStore() });
    h.database
      .prepare(
        "INSERT INTO jobs (id, path, status, created_at, finished_at) VALUES ('j', '/x', 'done', 'a', 'b')",
      )
      .run();

    await h.request('POST', '/api/maintenance/purge-hidden');
    await h.request('POST', '/api/maintenance/backup');
    await databaseTask(h, 'backup');
    await h.request('POST', '/api/maintenance/vacuum');
    await databaseTask(h, 'vacuum');
    await emptied(h, { all: true });

    const { entries } = (await h.request('GET', '/api/logs?component=maintenance&limit=50')).json<{
      entries: { message: string }[];
    }>();
    expect(entries.map(({ message }) => message).sort()).toEqual([
      'Backed up the database',
      'Compacted the database',
      'Emptied the files set aside',
      'Forgot the hidden analyses',
    ]);
  });
});
