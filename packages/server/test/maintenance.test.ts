import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, harness, makeDir, put, type Harness } from './harness.js';

afterEach(cleanup);

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
      expect((await h.request('POST', `/api/batches/${batch ?? ''}/undo`, {})).statusCode).toBe(
        200,
      );
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
