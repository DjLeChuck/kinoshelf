import { SvelteMap } from 'svelte/reactivity';

type State =
  | { readonly status: 'running'; readonly done: number; readonly total: number }
  | { readonly status: 'failed'; readonly error: unknown };

/**
 * What each validation in flight is doing, by entry id. It lives outside the panels: a panel is
 * destroyed when another row is opened, but its request goes on, and the list must still say
 * "validating" or show the error, on the row that was validated and no other.
 */
export class Validations {
  private readonly states = new SvelteMap<string, State>();

  start(id: string): void {
    this.states.set(id, { status: 'running', done: 0, total: 0 });
  }

  /** How far the server's planning of the release is: files read, out of the files it covers. */
  progress(id: string, done: number, total: number): void {
    if (this.states.get(id)?.status === 'running') {
      this.states.set(id, { status: 'running', done, total });
    }
  }

  /** `done` out of `total` while the server plans, `undefined` before it said anything. */
  progressOf(
    id: string | null | undefined,
  ): { readonly done: number; readonly total: number } | undefined {
    const state = id == null ? undefined : this.states.get(id);
    return state?.status === 'running' && state.total > 0
      ? { done: state.done, total: state.total }
      : undefined;
  }

  fail(id: string, error: unknown): void {
    this.states.set(id, { status: 'failed', error });
  }

  clear(id: string): void {
    this.states.delete(id);
  }

  running(id: string | null | undefined): boolean {
    return id != null && this.states.get(id)?.status === 'running';
  }

  /** The error of the last attempt on this entry, until it is tried again or settled. */
  failure(id: string | null | undefined): { readonly error: unknown } | undefined {
    const state = id == null ? undefined : this.states.get(id);
    return state?.status === 'failed' ? { error: state.error } : undefined;
  }

  anyRunning(ids: readonly (string | null)[]): boolean {
    return ids.some((id) => this.running(id));
  }

  firstFailure(ids: readonly (string | null)[]): { readonly error: unknown } | undefined {
    for (const id of ids) {
      const failure = this.failure(id);
      if (failure) return failure;
    }
    return undefined;
  }
}

export const validations = new Validations();

/**
 * The same for the batches started from a library (rename, refresh, add a version to the name),
 * by item id, and by `library:<id>` for the library as a whole: the click marks them at once,
 * where `page.transfer` only arrives with the next reload, so the same action cannot be sent twice.
 */
export const runs = new Validations();

export const libraryKey = (libraryId: string): string => `library:${libraryId}`;
