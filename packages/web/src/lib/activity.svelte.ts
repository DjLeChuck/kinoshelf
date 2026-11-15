import { api } from './api.js';
import { ordered, type ActivityTask } from './activity.js';

let tasks = $state<ActivityTask[]>([]);
let dismissed = $state<ReadonlySet<string>>(new Set());
let timer: ReturnType<typeof setTimeout> | undefined;

/** A bit more than the server keeps a finished task: nothing else tells the page it is gone. */
const SWEEP_MS = 16_000;

/**
 * What the server does in the background (`GET /api/activity`), read by the shell on each
 * `progress`, `jobs` or `history` event so that it shows wherever the person is. A task closed by
 * hand stays closed until it runs again.
 */
export const activity = {
  get tasks(): ActivityTask[] {
    return ordered(tasks.filter((task) => !dismissed.has(task.id)));
  },
  async load(): Promise<void> {
    try {
      tasks = (await api.get<{ tasks: ActivityTask[] }>('/api/activity')).tasks;
    } catch {
      // A panel that cannot be read is no panel: the pages say what failed on their own.
      return;
    }
    const running = new Set(tasks.filter(({ status }) => status === 'running').map(({ id }) => id));
    if ([...dismissed].some((id) => running.has(id))) {
      dismissed = new Set([...dismissed].filter((id) => !running.has(id)));
    }
    // A finished task leaves the server's list by itself, with no event to say so.
    clearTimeout(timer);
    timer = tasks.some(({ status }) => status !== 'running')
      ? setTimeout(() => void activity.load(), SWEEP_MS)
      : undefined;
  },
  dismiss(id: string): void {
    dismissed = new Set([...dismissed, id]);
  },
  /** Sign-out: nothing of this session stays. */
  clear(): void {
    clearTimeout(timer);
    timer = undefined;
    tasks = [];
    dismissed = new Set();
  },
};
