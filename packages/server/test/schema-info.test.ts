import { applyMigrations, Database } from '@kinoshelf/core';
import { describe, expect, it } from 'vitest';
import { migrationState } from '../src/schema-info.js';

describe('migrationState', () => {
  it('counts what was applied and names the last one, in the order it was applied', () => {
    const database = new Database(':memory:');
    applyMigrations(database, [
      { name: 'x:002-b', sql: 'CREATE TABLE b (id INTEGER)' },
      { name: 'x:001-a', sql: 'CREATE TABLE a (id INTEGER)' },
    ]);
    const state = migrationState(database);
    // Applied order, not alphabetical: the name that sorts first came second.
    expect(state).toMatchObject({ applied: 2, last: { name: 'x:001-a' } });
    expect(Date.parse(state.last?.appliedAt ?? '')).not.toBeNaN();
  });

  it('says so on a database with none', () => {
    const database = new Database(':memory:');
    database.exec(
      'CREATE TABLE schema_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)',
    );
    expect(migrationState(database)).toEqual({ applied: 0, last: null });
  });
});
