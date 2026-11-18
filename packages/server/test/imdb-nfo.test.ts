import { readFile, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MetadataProvider } from '@kinoshelf/core';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fakeProvider, harness, makeDir, put } from './harness.js';

afterEach(cleanup);

const DUNE = 438631;
const IMDB_ID = 'tt1160419';

/** The fake TMDB, which knows the IMDb id of Dune. */
const provider: MetadataProvider = {
  ...fakeProvider,
  getMovieDetails: async (id) => {
    const details = await fakeProvider.getMovieDetails(id);
    return details && id.id === DUNE ? { ...details, imdbId: IMDB_ID } : details;
  },
};

async function organized(imdbRatings = true) {
  const root = await makeDir();
  await put(join(root, 'Dune.2021.mkv'), 'dune');
  const h = await harness({
    createProvider: () => provider,
    configDir: await makeDir(),
    config: {
      imdbRatings,
      libraries: [
        {
          id: 'films',
          name: 'Films',
          source: root,
          type: 'movie',
          naming: 'no-id',
          metadata: 'nfo',
        },
      ],
    },
  });
  await h.request('POST', '/api/libraries/films/scan');
  await h.app.jobs.idle();
  const list = (await h.request('GET', '/api/libraries/films/items')).json<{
    items: { id: string; title: string }[];
  }>();
  await h.request('POST', '/api/libraries/films/execute', {
    items: [list.items.find((item) => item.title === 'Dune')?.id],
  });
  await h.app.jobs.idle();
  const nfo = join(root, 'Dune (2021)', 'movie.nfo');
  // The dataset arrives after the NFO was written, which is the case this is for.
  const download = () => {
    h.database.exec(
      `INSERT INTO imdb_ratings (id, rating, votes) VALUES ('${IMDB_ID}', 8, 900000)`,
    );
    h.database.exec(
      'INSERT OR REPLACE INTO imdb_ratings_info (singleton, fetched_at, entries) VALUES (1, 0, 1)',
    );
  };
  const add = () => h.request('POST', '/api/libraries/films/imdb-nfo', { tmdbId: DUNE });
  return { h, root, nfo, download, add };
}

describe('POST /api/libraries/:id/imdb-nfo', () => {
  it('adds the rating to the NFO Kinoshelf wrote, and the batch can be undone', async () => {
    const { h, nfo, download, add } = await organized();
    const before = await readFile(nfo, 'utf8');
    expect(before).not.toContain('name="imdb"');
    download();

    const answer = await add();
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toMatchObject({ rewritten: 1, kept: 0 });
    const after = await readFile(nfo, 'utf8');
    // The fake TMDB gives no rating of its own, so IMDb's is the default one.
    expect(after).toContain('<rating name="imdb" max="10" default="true">');
    expect(after).toContain('<value>8.00</value>');

    // Nothing more to do the second time.
    expect((await add()).json()).toMatchObject({ rewritten: 0, already: 1, batchId: null });

    const batch = answer.json<{ batchId: string }>().batchId;
    const undone = await h.undo(batch);
    expect(undone.statusCode).toBeLessThan(300);
    expect(await readFile(nfo, 'utf8')).toBe(before);
  });

  it('leaves an NFO that was edited since', async () => {
    const { nfo, download, add } = await organized();
    download();
    await writeFile(nfo, `${await readFile(nfo, 'utf8')}<!-- by hand -->\n`);
    await utimes(nfo, new Date(), new Date(Date.now() + 5000));

    expect((await add()).json()).toMatchObject({ rewritten: 0, kept: 1, batchId: null });
    expect(await readFile(nfo, 'utf8')).toContain('by hand');
  });

  it('says nothing is written for a work the file does not know', async () => {
    const { h, nfo, add } = await organized();
    h.database.exec(`INSERT INTO imdb_ratings (id, rating, votes) VALUES ('tt0', 1, 1)`);
    h.database.exec(
      'INSERT OR REPLACE INTO imdb_ratings_info (singleton, fetched_at, entries) VALUES (1, 0, 1)',
    );
    expect((await add()).json()).toMatchObject({ rewritten: 0, noRating: 1 });
    expect(await readFile(nfo, 'utf8')).not.toContain('name="imdb"');
  });

  it('is refused while the setting is off or the file is not there', async () => {
    const off = await organized(false);
    expect((await off.add()).json<{ error: { code: string } }>().error.code).toBe(
      'imdb.not-enabled',
    );
    const waiting = await organized();
    const refused = await waiting.add();
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('imdb.not-downloaded');
  });
});

describe('POST /api/maintenance/imdb-nfo', () => {
  it('runs over every library as a task and reports what it did', async () => {
    const { h, nfo, download } = await organized();
    download();
    const started = await h.request('POST', '/api/maintenance/imdb-nfo');
    expect(started.statusCode).toBe(202);

    type Figures = { imdbNfoTask: { status: string; result: { rewritten: number } | null } | null };
    let figures = (await h.request('GET', '/api/maintenance')).json<Figures>();
    for (let i = 0; i < 200 && figures.imdbNfoTask?.status === 'running'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      figures = (await h.request('GET', '/api/maintenance')).json<Figures>();
    }
    expect(figures.imdbNfoTask).toMatchObject({ status: 'done', result: { rewritten: 1 } });
    expect(await readFile(nfo, 'utf8')).toContain('name="imdb"');
  });

  it('is refused until the ratings are there', async () => {
    const { h } = await organized();
    const refused = await h.request('POST', '/api/maintenance/imdb-nfo');
    expect(refused.statusCode).toBe(409);
  });
});
