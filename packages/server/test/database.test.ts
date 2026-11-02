import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '@kinoshelf/core';
import { migrated, SERVER_MIGRATIONS } from '../src/database.js';

describe('server migrations', () => {
  it('upgrade a database created before the entries table, keeping its jobs', () => {
    const database = new Database(':memory:');
    // A server of the previous layout: jobs hold their analysis in a column.
    applyMigrations(database, SERVER_MIGRATIONS.slice(0, 2));
    database
      .prepare(
        "INSERT INTO jobs (id, path, status, created_at, summary, analysis) VALUES ('j1', '/a', 'done', 'now', '{}', '{}')",
      )
      .run();

    migrated(database);

    const columns = database
      .prepare<[], { name: string }>("SELECT name FROM pragma_table_info('jobs')")
      .all()
      .map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(['apply', 'settings']));
    expect(columns).not.toContain('analysis');
    expect(columns).not.toContain('batch_id');
    expect(database.prepare('SELECT path, apply FROM jobs').get()).toEqual({
      path: '/a',
      apply: 0,
    });
    expect(database.prepare('SELECT COUNT(*) AS n FROM job_entries').get()).toEqual({ n: 0 });
  });

  it('upgrade a database of the previous layout, keeping its jobs and creating the executions table', () => {
    const database = new Database(':memory:');
    applyMigrations(database, SERVER_MIGRATIONS.slice(0, 3));
    database
      .prepare(
        "INSERT INTO jobs (id, path, status, created_at, apply, batch_id) VALUES ('j1', '/a', 'done', 'now', 1, 'b1')",
      )
      .run();

    migrated(database);

    expect(database.prepare('SELECT path, apply FROM jobs').get()).toEqual({
      path: '/a',
      apply: 1,
    });
    expect(database.prepare('SELECT COUNT(*) AS n FROM executions').get()).toEqual({ n: 0 });
  });

  it('is idempotent: applying twice changes nothing', () => {
    const database = migrated(new Database(':memory:'));
    expect(() => migrated(database)).not.toThrow();
  });

  it('creates the onboarding table on a database of the previous layout', () => {
    const database = new Database(':memory:');
    applyMigrations(database, SERVER_MIGRATIONS.slice(0, 8));

    migrated(database);
    migrated(database);

    expect(database.prepare('SELECT COUNT(*) AS n FROM onboarding_state').get()).toEqual({ n: 0 });
  });
});

describe('library migrations', () => {
  it('add the library snapshot to a database of the previous layout', () => {
    const database = new Database(':memory:');
    applyMigrations(database, SERVER_MIGRATIONS.slice(0, 10));
    database
      .prepare(
        "INSERT INTO jobs (id, path, status, created_at, library_id) VALUES ('j1', '/a', 'done', 'now', 'films')",
      )
      .run();

    migrated(database);
    migrated(database);

    expect(database.prepare('SELECT library_id FROM jobs').get()).toEqual({ library_id: 'films' });
    expect(database.prepare('SELECT COUNT(*) AS n FROM library_items').get()).toEqual({ n: 0 });
  });

  it('drop the remembered destinations, and keep one row per file of a library', () => {
    const database = new Database(':memory:');
    applyMigrations(database, SERVER_MIGRATIONS.slice(0, 17));
    database
      .prepare(
        "INSERT INTO work_destinations (kind, tmdb_id, library_id, created_at) VALUES ('movie', 603, 'films', 'now')",
      )
      .run();
    migrated(database);
    expect(() => database.prepare('SELECT * FROM work_destinations').all()).toThrow(
      /no such table/,
    );

    const item = database.prepare(
      "INSERT INTO library_items (library_id, path, state, scanned_at) VALUES (?, ?, 'ok', 'now')",
    );
    item.run('films', '/f/a.mkv');
    expect(() => item.run('shows', '/f/a.mkv')).not.toThrow();
    expect(() => item.run('films', '/f/a.mkv')).toThrow(/UNIQUE/);
  });
});
