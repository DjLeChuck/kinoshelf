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
});
