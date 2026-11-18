import { gzipSync } from 'node:zlib';
import { Database } from '@kinoshelf/core';
import { describe, expect, it } from 'vitest';
import { ImdbRatings, withImdbRatings } from '../src/imdb-ratings.js';

const FILE = gzipSync(
  'tconst\taverageRating\tnumVotes\ntt0000001\t5.7\t2100\ntt1160419\t8.0\t900000\nbroken line\n',
);

const served =
  (body: Uint8Array | null, status = 200): typeof fetch =>
  () =>
    Promise.resolve(new Response(body, { status }));

describe('ImdbRatings', () => {
  it('reads the ratings of the dataset it downloaded', async () => {
    const ratings = new ImdbRatings(new Database(':memory:'), { fetch: served(FILE) });
    expect(ratings.rating('tt1160419')).toBeUndefined();
    await ratings.refresh();
    expect(ratings.task()?.status).toBe('done');
    expect(ratings.task()?.done).toBe(2);
    expect(ratings.rating('tt1160419')).toEqual({ value: 8, votes: 900000 });
    expect(ratings.rating('tt9999999')).toBeUndefined();
  });

  it('downloads nothing until asked, and a day-old dataset only once a day', async () => {
    let calls = 0;
    let at = 1_000_000_000_000;
    const count: typeof fetch = (...args) => {
      calls += 1;
      return served(FILE)(...args);
    };
    const ratings = new ImdbRatings(new Database(':memory:'), { fetch: count, now: () => at });
    expect(calls).toBe(0);
    ratings.refreshIfStale();
    await ratings.idle();
    expect(calls).toBe(1);
    at += 23 * 3_600_000;
    ratings.refreshIfStale();
    await ratings.idle();
    expect(calls).toBe(1);
    at += 2 * 3_600_000;
    ratings.refreshIfStale();
    await ratings.idle();
    expect(calls).toBe(2);
  });

  it('keeps yesterday’s ratings when a download fails, and reports it', async () => {
    const db = new Database(':memory:');
    await new ImdbRatings(db, { fetch: served(FILE) }).refresh();
    const failing = new ImdbRatings(db, { fetch: served(null, 503) });
    await failing.refresh();
    expect(failing.task()?.status).toBe('failed');
    expect(failing.rating('tt1160419')).toEqual({ value: 8, votes: 900000 });
  });

  it('refuses a file that is not the dataset', async () => {
    const ratings = new ImdbRatings(new Database(':memory:'), {
      fetch: served(gzipSync('<html>nope</html>\n')),
    });
    await ratings.refresh();
    expect(ratings.task()?.status).toBe('failed');
  });
});

describe('ImdbRatings tables', () => {
  it('forgets a table of an older shape instead of failing on it', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE imdb_ratings_info (singleton INTEGER PRIMARY KEY, fetched_at INTEGER)');
    db.exec('INSERT INTO imdb_ratings_info VALUES (1, 5)');
    const ratings = new ImdbRatings(db);
    expect(ratings.fetchedAt()).toBeNull();
    expect(ratings.figures().entries).toBe(0);
  });
});

describe('withImdbRatings', () => {
  const provider = {
    name: 'fake',
    getMovieDetails: () => Promise.resolve({ imdbId: 'tt1160419', title: 'Dune' }),
    getSeriesDetails: () => Promise.resolve(null),
    other: () => 'kept',
  } as never;

  it('adds the rating of the work, and leaves the rest of the provider alone', async () => {
    const wrapped = withImdbRatings(provider, {
      rating: (id) => (id === 'tt1160419' ? { value: 8, votes: 1 } : undefined),
    });
    expect(await wrapped.getMovieDetails({ provider: 'fake', id: 1 })).toMatchObject({
      imdbRating: { value: 8, votes: 1 },
    });
    expect(await wrapped.getSeriesDetails({ provider: 'fake', id: 1 })).toBeNull();
    expect((wrapped as unknown as { other: () => string }).other()).toBe('kept');
  });

  it('leaves a work the dataset does not know as it was', async () => {
    const wrapped = withImdbRatings(provider, { rating: () => undefined });
    expect(await wrapped.getMovieDetails({ provider: 'fake', id: 1 })).not.toHaveProperty(
      'imdbRating',
    );
  });
});
