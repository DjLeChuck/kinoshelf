import {
  DatabaseSync,
  type SQLInputValue,
  type SQLOutputValue,
  type StatementSync,
} from 'node:sqlite';

type SqlFunction = (...args: SQLOutputValue[]) => SQLInputValue;

/**
 * The SQLite driver is Node's own (`node:sqlite`), behind the small part of better-sqlite3's API
 * the code uses: `prepare`, `exec`, `pragma`, `function`,
 * `transaction` and a few more. A native module is one binary to ship per platform and per Node
 * version; this is none.
 *
 * Parameters are passed as they come. Unlike better-sqlite3, `node:sqlite` does not refuse
 * `undefined` (stored as NULL) or booleans (stored as 0 and 1): a stray one is no longer an error.
 * The code passes neither (it writes `bit()` and `null` explicitly), and converting them on every
 * call cost up to 60 % more on inserts.
 */

export interface RunResult {
  /** A number: `node:sqlite` may give a `bigint`, better-sqlite3 never did. */
  changes: number;
  lastInsertRowid: number | bigint;
}

export class Statement<Params extends unknown[] = unknown[], Result = unknown> {
  readonly #statement: StatementSync;

  constructor(statement: StatementSync) {
    this.#statement = statement;
  }

  /** Rows as arrays of values instead of objects, until called again with `false`. */
  raw(on = true): this {
    this.#statement.setReturnArrays(on);
    return this;
  }

  run(...params: Params): RunResult {
    const result = this.#statement.run(...(params as unknown[] as never[]));
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  }

  get(...params: Params): Result | undefined {
    return this.#statement.get(...(params as unknown[] as never[])) as Result | undefined;
  }

  all(...params: Params): Result[] {
    return this.#statement.all(...(params as unknown[] as never[])) as Result[];
  }

  iterate(...params: Params): IterableIterator<Result> {
    return this.#statement.iterate(...(params as unknown[] as never[])) as IterableIterator<Result>;
  }
}

export interface FunctionOptions {
  deterministic?: boolean;
  varargs?: boolean;
}

/** A function run in a transaction: the same function, with the other ways of beginning one. */
export interface Transaction<Args extends unknown[], Result> {
  (...args: Args): Result;
  deferred: (...args: Args) => Result;
  immediate: (...args: Args) => Result;
  exclusive: (...args: Args) => Result;
}

export class Database {
  readonly #database: DatabaseSync;
  /** How many transactions are open: a nested one is a savepoint. */
  #depth = 0;
  readonly name: string;
  readonly memory: boolean;

  /** `timeout` is how long a writer waits for the other process before SQLITE_BUSY. */
  constructor(path = ':memory:', options: { timeout?: number } = {}) {
    this.#database = new DatabaseSync(path, { timeout: options.timeout ?? 5000 });
    this.name = path;
    this.memory = path === ':memory:';
  }

  get open(): boolean {
    return this.#database.isOpen;
  }

  get inTransaction(): boolean {
    return this.#database.isTransaction;
  }

  prepare<Params extends unknown[] = unknown[], Result = unknown>(
    sql: string,
  ): Statement<Params, Result> {
    return new Statement<Params, Result>(this.#database.prepare(sql));
  }

  exec(sql: string): this {
    this.#database.exec(sql);
    return this;
  }

  /** `pragma('journal_mode = WAL')`; `{ simple: true }` gives the first value of the first row. */
  pragma(text: string, options: { simple: true }): unknown;
  pragma(text: string, options?: { simple?: false }): unknown[];
  pragma(text: string, options: { simple?: boolean } = {}): unknown {
    const rows = this.#database.prepare(`PRAGMA ${text}`).all();
    if (options.simple === true) {
      const first = rows[0];
      return first === undefined ? undefined : Object.values(first)[0];
    }
    return rows;
  }

  /** Makes a JavaScript function callable from SQL. */
  function(name: string, fn: (...args: unknown[]) => unknown): this;
  function(name: string, options: FunctionOptions, fn: (...args: unknown[]) => unknown): this;
  function(
    name: string,
    optionsOrFn: FunctionOptions | ((...args: unknown[]) => unknown),
    maybeFn?: (...args: unknown[]) => unknown,
  ): this {
    const [options, fn] =
      typeof optionsOrFn === 'function' ? [{}, optionsOrFn] : [optionsOrFn, maybeFn];
    if (fn === undefined) {
      throw new TypeError('function() needs a function');
    }
    this.#database.function(name, options, fn as unknown as SqlFunction);
    return this;
  }

  /**
   * Wraps `fn` in a transaction: committed when it returns, rolled back when it throws. Called
   * inside another one it is a savepoint, so only its own work is undone when it throws.
   */
  transaction<Args extends unknown[], Result>(
    fn: (...args: Args) => Result,
  ): Transaction<Args, Result> {
    const make =
      (begin: string) =>
      (...args: Args): Result => {
        const nested = this.#depth > 0;
        const savepoint = `kinoshelf_sp${String(this.#depth)}`;
        this.#database.exec(nested ? `SAVEPOINT ${savepoint}` : begin);
        this.#depth++;
        try {
          const result = fn(...args);
          this.#depth--;
          this.#database.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
          return result;
        } catch (error) {
          this.#depth--;
          if (nested) {
            this.#database.exec(`ROLLBACK TO ${savepoint}`);
            this.#database.exec(`RELEASE ${savepoint}`);
          } else if (this.#database.isTransaction) {
            this.#database.exec('ROLLBACK');
          }
          throw error;
        }
      };
    const run = make('BEGIN') as Transaction<Args, Result>;
    run.deferred = run;
    run.immediate = make('BEGIN IMMEDIATE');
    run.exclusive = make('BEGIN EXCLUSIVE');
    return run;
  }

  close(): this {
    if (this.#database.isOpen) {
      this.#database.close();
    }
    return this;
  }
}
