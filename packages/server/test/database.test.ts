import { describe, expect, it } from 'vitest';
import { Database } from '@kinoshelf/core';
import { migrated } from '../src/database.js';

describe('server schema', () => {
  it('is created once and left alone by a second opening', () => {
    const database = new Database(':memory:');
    migrated(database);
    database
      .prepare("INSERT INTO jobs (id, path, status, created_at) VALUES ('j1', '/a', 'done', 'now')")
      .run();

    migrated(database);

    expect(database.prepare('SELECT name FROM schema_migrations').all()).toEqual([
      { name: 'server:001-initial' },
    ]);
    expect(database.prepare('SELECT path, apply FROM jobs').get()).toEqual({
      path: '/a',
      apply: 0,
    });
  });

  it('keeps one row per file of a library', () => {
    const database = migrated(new Database(':memory:'));
    const item = database.prepare(
      "INSERT INTO library_items (library_id, path, state, scanned_at) VALUES (?, ?, 'ok', 'now')",
    );
    item.run('films', '/f/a.mkv');
    expect(() => item.run('shows', '/f/a.mkv')).not.toThrow();
    expect(() => item.run('films', '/f/a.mkv')).toThrow(/UNIQUE/);
  });
});
