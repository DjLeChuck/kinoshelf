import { api } from './api.js';
import type { Onboarding } from './onboarding.js';

let onboarding = $state<Onboarding | undefined>(undefined);

/**
 * Whether the welcome page has been left, fetched once by the shell for the navigation and the
 * root page. A failed fetch leaves it unknown, and the nav then shows everything rather than
 * hide pages behind a request that did not answer.
 */
export const shell = {
  get onboarding(): Onboarding | undefined {
    return onboarding;
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
};
