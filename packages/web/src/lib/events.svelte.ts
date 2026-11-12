import { onDestroy } from 'svelte';
import { session } from './session.svelte.js';
import { Stream } from './stream.js';

/** What the server says changed; `ready` fires on each (re)connection, when anything may have. */
export type Topic = 'jobs' | 'progress' | 'arrivals' | 'history' | 'settings' | 'logs' | 'ready';

const TOPICS: readonly Topic[] = [
  'jobs',
  'progress',
  'arrivals',
  'history',
  'settings',
  'logs',
  'ready',
];
const listeners = new Map<Topic, Set<() => void>>();

function fire(topic: Topic): void {
  for (const listener of listeners.get(topic) ?? []) {
    listener();
  }
}

const stream = new Stream({
  open: () => new EventSource('/api/events'),
  check: () => session.check(),
  signedIn: () => session.status === 'signed-in',
  topics: TOPICS,
  fire: (topic) => {
    fire(topic as Topic);
  },
});

/**
 * One stream for the whole app, opened once signed in and closed on sign-out. `ready` fires on
 * each (re)connection: the views refetch what they missed.
 */
export function connectEvents(): void {
  stream.connect();
}

export function disconnectEvents(): void {
  stream.disconnect();
}

/**
 * Calls `listener` whenever one of `topics` fires, until the returned function is called. Unlike
 * `refetchOn`, it belongs to no component: a validation outlives the panel that started it.
 */
export function onTopics(topics: readonly Topic[], listener: () => void): () => void {
  const sets = topics.map((topic) => {
    const set = listeners.get(topic) ?? new Set<() => void>();
    set.add(listener);
    listeners.set(topic, set);
    return set;
  });
  return () => {
    for (const set of sets) {
      set.delete(listener);
    }
  };
}

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
