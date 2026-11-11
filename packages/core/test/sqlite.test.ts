import { describe, expect, it } from 'vitest';
import { Database } from '../src/index.js';

const memory = (): Database => new Database(':memory:').exec('CREATE TABLE t (n INTEGER, s TEXT)');

const count = (database: Database): number =>
  database.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM t').get()?.c ?? -1;

describe('the SQLite adapter', () => {
  it('runs, reads and iterates statements', () => {
    const database = memory();
    const insert = database.prepare<[number, string]>('INSERT INTO t (n, s) VALUES (?, ?)');
    expect(insert.run(1, 'a')).toEqual({ changes: 1, lastInsertRowid: 1 });
    insert.run(2, 'b');

    const select = database.prepare<[number], { n: number; s: string }>(
      'SELECT n, s FROM t WHERE n >= ? ORDER BY n',
    );
    expect(select.get(2)).toEqual({ n: 2, s: 'b' });
    expect(select.get(3)).toBeUndefined();
    expect(select.all(1).map((row) => row.s)).toEqual(['a', 'b']);
    expect([...select.iterate(1)].length).toBe(2);
  });

  it('counts changes as a number, whatever the driver gives', () => {
    const database = memory();
    database.exec("INSERT INTO t VALUES (1, 'a'), (2, 'b')");
    const { changes } = database.prepare('DELETE FROM t').run();
    expect(changes).toBe(2);
    expect(typeof changes).toBe('number');
  });

  it('reads rows as arrays with raw()', () => {
    const database = memory();
    database.exec("INSERT INTO t VALUES (1, 'a')");
    const select = database.prepare('SELECT n, s FROM t');
    expect(select.raw().get()).toEqual([1, 'a']);
    expect(select.raw(false).get()).toEqual({ n: 1, s: 'a' });
  });

  it('reads and sets pragmas', () => {
    const database = memory();
    database.pragma('user_version = 7');
    expect(database.pragma('user_version', { simple: true })).toBe(7);
    expect(database.pragma('user_version')).toEqual([{ user_version: 7 }]);
  });

  it('exposes JavaScript functions to SQL', () => {
    const database = memory();
    database.function('twice', { deterministic: true }, (value) => Number(value) * 2);
    database.function('shout', (value) => String(value).toUpperCase());
    expect(database.prepare('SELECT twice(21) AS a, shout(?) AS b').get('hi')).toEqual({
      a: 42,
      b: 'HI',
    });
  });

  it('commits a transaction, or rolls it back when it throws', () => {
    const database = memory();
    const add = (n: number): void => {
      database.prepare('INSERT INTO t (n) VALUES (?)').run(n);
    };
    database.transaction(() => {
      add(1);
      expect(database.inTransaction).toBe(true);
    })();
    expect(database.inTransaction).toBe(false);
    expect(count(database)).toBe(1);

    expect(() =>
      database.transaction(() => {
        add(2);
        throw new Error('boom');
      })(),
    ).toThrow('boom');
    expect(database.inTransaction).toBe(false);
    expect(count(database)).toBe(1);
  });

  it('passes arguments and the result through a transaction', () => {
    const database = memory();
    const insert = database.transaction((a: number, b: number) => {
      database.prepare('INSERT INTO t (n) VALUES (?), (?)').run(a, b);
      return a + b;
    });
    expect(insert(3, 4)).toBe(7);
    expect(insert.immediate(5, 6)).toBe(11);
    expect(insert.exclusive(7, 8)).toBe(15);
    expect(insert.deferred(9, 10)).toBe(19);
    expect(count(database)).toBe(8);
  });

  it('undoes only the inner transaction that threw, in a nested one', () => {
    const database = memory();
    const add = (n: number): void => {
      database.prepare('INSERT INTO t (n) VALUES (?)').run(n);
    };
    const inner = database.transaction(() => {
      add(2);
      throw new Error('inner');
    });
    database.transaction(() => {
      add(1);
      expect(() => {
        inner();
      }).toThrow('inner');
      add(3);
    })();
    expect(database.prepare<[], { n: number }>('SELECT n FROM t ORDER BY n').all()).toEqual([
      { n: 1 },
      { n: 3 },
    ]);

    // An outer failure takes the inner work with it, and later transactions start clean.
    expect(() =>
      database.transaction(() => {
        database.transaction(() => {
          add(4);
        })();
        throw new Error('outer');
      })(),
    ).toThrow('outer');
    expect(count(database)).toBe(2);
    database.transaction(() => {
      add(5);
    })();
    expect(count(database)).toBe(3);
  });

  it('closes, and says so', () => {
    const database = memory();
    expect(database.open).toBe(true);
    database.close().close();
    expect(database.open).toBe(false);
  });
});
