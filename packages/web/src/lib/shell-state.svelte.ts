import { api } from './api.js';
import { QUEUE_LIMIT } from './home.js';
import type { Onboarding } from './onboarding.js';
import type { QueueEntry } from './queue.js';

let onboarding = $state<Onboarding | undefined>(undefined);
let queue = $state<readonly QueueEntry[] | undefined>(undefined);

/**
 * What the navigation and the home page both read, fetched once by the shell: the badge of the
 * queue, and whether the welcome page has been left. A failed fetch leaves the value unknown, and
 * the nav then shows everything rather than hide pages behind a request that did not answer.
 */
export const shell = {
  get onboarding(): Onboarding | undefined {
    return onboarding;
  },
  get queue(): readonly QueueEntry[] | undefined {
    return queue;
  },
  setOnboarding(value: Onboarding): void {
    onboarding = value;
  },
  async loadOnboarding(): Promise<void> {
    try {
      onboarding = await api.get<Onboarding>('/api/onboarding');
    } catch {
      // The pages say what failed when they load their own data.
    }
  },
  async loadQueue(): Promise<void> {
    try {
      queue = await api.get<QueueEntry[]>(`/api/queue?limit=${QUEUE_LIMIT}`);
    } catch {
      // Same as above.
    }
  },
};
