import { onDestroy } from 'svelte';

/** What the server says changed; `ready` fires on each (re)connection, when anything may have. */
export type Topic = 'jobs' | 'queue' | 'history' | 'settings' | 'ready';

const TOPICS: readonly Topic[] = ['jobs', 'queue', 'history', 'settings', 'ready'];
const listeners = new Map<Topic, Set<() => void>>();
let source: EventSource | undefined;
let connected = $state(false);

function fire(topic: Topic): void {
  for (const listener of listeners.get(topic) ?? []) {
    listener();
  }
}

/** One stream for the whole app, opened once signed in and closed on sign-out. */
export function connectEvents(): void {
  if (source) {
    return;
  }
  source = new EventSource('/api/events');
  for (const topic of TOPICS) {
    source.addEventListener(topic, () => {
      if (topic === 'ready') {
        connected = true;
      }
      fire(topic);
    });
  }
  // The browser reconnects by itself; `ready` then tells the views to refetch what they missed.
  source.addEventListener('error', () => {
    connected = false;
  });
}

export function disconnectEvents(): void {
  source?.close();
  source = undefined;
  connected = false;
}

export const stream = {
  get connected(): boolean {
    return connected;
  },
};

/**
 * Runs `refetch` now and whenever one of `topics` fires (a burst counts once), until the
 * component is destroyed. A view calls it once, from its script.
 */
export function refetchOn(topics: readonly Topic[], refetch: () => void, delayMs = 150): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(refetch, delayMs);
  };
  const off = topics.map((topic) => {
    const set = listeners.get(topic) ?? new Set<() => void>();
    set.add(schedule);
    listeners.set(topic, set);
    return () => set.delete(schedule);
  });
  refetch();
  onDestroy(() => {
    clearTimeout(timer);
    for (const stop of off) {
      stop();
    }
  });
}
