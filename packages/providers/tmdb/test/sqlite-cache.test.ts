import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { SqliteHttpCache } from '../src/index.js';

describe('SqliteHttpCache', () => {
  const make = () => new SqliteHttpCache(new Database(':memory:'));

  it('returns a stored entry until it expires', () => {
    const cache = make();
    cache.set('k', { status: 200, body: '{"a":1}' }, 1000);
    expect(cache.get('k', 999)).toEqual({ status: 200, body: '{"a":1}' });
    expect(cache.get('k', 1000)).toBeUndefined();
    expect(cache.get('missing', 0)).toBeUndefined();
  });

  it('overwrites an existing key', () => {
    const cache = make();
    cache.set('k', { status: 200, body: 'old' }, 1000);
    cache.set('k', { status: 404, body: 'new' }, 5000);
    expect(cache.get('k', 2000)).toEqual({ status: 404, body: 'new' });
  });

  it('prunes only expired rows', () => {
    const cache = make();
    cache.set('old', { status: 200, body: '' }, 10);
    cache.set('fresh', { status: 200, body: '' }, 100);
    expect(cache.prune(50)).toBe(1);
    expect(cache.get('fresh', 50)).toBeDefined();
  });

  it('shares a database file with other tables and survives reopening', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec('CREATE TABLE other (id INTEGER)');
    new SqliteHttpCache(sqlite).set('k', { status: 200, body: 'x' }, 1000);
    expect(new SqliteHttpCache(sqlite).get('k', 0)).toEqual({ status: 200, body: 'x' });
  });
});
