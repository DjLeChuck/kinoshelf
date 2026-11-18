import { SvelteSet } from 'svelte/reactivity';
import { MAX_SELECTION } from './library-items.js';

export interface TicksOptions<Row, Key> {
  /** The rows that can be ticked, as the page holds them now (read again at each use). */
  rows: () => readonly Row[];
  key: (row: Row) => Key;
  /** How many rows the filter holds in all, shown or not; `undefined` until the list is read. */
  total: () => number | undefined;
  /** How many rows the page holds, tickable or not: fewer than `total` means more can be read. */
  loaded: () => number;
  /** Reads the whole list under the filter, so that `rows` holds all of it afterwards. */
  readAll: () => Promise<void>;
}

/**
 * The rows ticked in a list (movies by id, shows by TMDB id), shared by the two lists of a library.
 * A tick is kept by key, so it survives the page being read again; `picked` only holds the rows
 * still on screen, which is what an action may use.
 */
export class Ticks<Row, Key extends string | number> {
  // A reactive set rather than `$state`: the file is plain TypeScript to the tests, as `Validations` is.
  readonly #keys = new SvelteSet<Key>();
  readonly #options: TicksOptions<Row, Key>;

  constructor(options: TicksOptions<Row, Key>) {
    this.#options = options;
  }

  /** The keys ticked, whether or not their row is on screen (a request carries these). */
  get keys(): ReadonlySet<Key> {
    return new Set(this.#keys);
  }

  /** The ticked rows that are on screen. */
  get picked(): readonly Row[] {
    const keys = this.keys;
    return this.#options.rows().filter((row) => keys.has(this.#options.key(row)));
  }

  has(key: Key): boolean {
    return this.#keys.has(key);
  }

  toggle(key: Key, on: boolean): void {
    if (on) {
      this.#keys.add(key);
    } else {
      this.#keys.delete(key);
    }
  }

  /** The state of the "select all" box: all of the rows on screen are ticked. */
  get everyPicked(): boolean {
    return this.picked.length === this.#options.rows().length;
  }

  get somePicked(): boolean {
    return this.picked.length > 0 && !this.everyPicked;
  }

  all(on: boolean): void {
    this.#keys.clear();
    if (on) {
      for (const row of this.#options.rows()) {
        this.#keys.add(this.#options.key(row));
      }
    }
  }

  clear(): void {
    this.#keys.clear();
  }

  /**
   * "Select everything" is offered once the page is ticked whole and more rows exist than it shows,
   * up to what the server takes in one selection (`MAX_SELECTION`): beyond it the list is not read whole.
   */
  get canPickEverything(): boolean {
    const total = this.#options.total();
    return (
      total !== undefined &&
      total > this.#options.loaded() &&
      total <= MAX_SELECTION &&
      this.picked.length > 0 &&
      this.everyPicked
    );
  }

  /** Reads every row under the filter, then ticks them all: the ones off screen count too. */
  async pickEverything(): Promise<void> {
    await this.#options.readAll();
    // The read replaced the page while this waited: take the rows it holds now.
    this.all(true);
  }
}
