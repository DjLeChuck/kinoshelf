import { refetchOn, type Topic } from './events.svelte.js';

/**
 * A value read from the API that follows the server: read now and again whenever one of `topics`
 * fires. Each read carries a ticket, so an answer to a read that a newer one replaced is dropped
 * and never overwrites fresher data. A failed read keeps the last value and reports `failure`.
 * A view calls it once, from its script.
 */
export function resource<T>(
  fetcher: () => Promise<T>,
  topics: readonly Topic[],
): {
  readonly value: T | undefined;
  /** Settable: a view's own actions report their failures where the read reports its own. */
  failure: unknown;
  reload: () => Promise<void>;
} {
  let value = $state<T | undefined>(undefined);
  let failure = $state<unknown>(undefined);
  let latest = 0;

  async function reload(): Promise<void> {
    const ticket = ++latest;
    try {
      const read = await fetcher();
      if (ticket === latest) {
        value = read;
        failure = undefined;
      }
    } catch (error) {
      if (ticket === latest) {
        failure = error;
      }
    }
  }

  refetchOn(topics, () => void reload());

  return {
    get value() {
      return value;
    },
    get failure() {
      return failure;
    },
    set failure(error: unknown) {
      failure = error;
    },
    reload,
  };
}
