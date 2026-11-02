import { api } from './api.js';
import type { Onboarding } from './onboarding.js';

let onboarding = $state<Onboarding | undefined>(undefined);
let arrivals = $state<number | undefined>(undefined);
/** Why the welcome state could not be read: the root page says it, rather than load forever. */
let onboardingFailure = $state<unknown>(undefined);

/**
 * Whether the welcome page has been left, fetched once by the shell for the navigation and the
 * root page. A failed fetch leaves it unknown, and the nav then shows everything rather than
 * hide pages behind a request that did not answer.
 */
export const shell = {
  get onboarding(): Onboarding | undefined {
    return onboarding;
  },
  /** Files waiting in the arrival folders: the badge of the navigation. */
  get arrivals(): number | undefined {
    return arrivals;
  },
  get onboardingFailure(): unknown {
    return onboardingFailure;
  },
  setOnboarding(value: Onboarding): void {
    onboarding = value;
  },
  async loadOnboarding(): Promise<void> {
    try {
      onboarding = await api.get<Onboarding>('/api/onboarding');
      onboardingFailure = undefined;
    } catch (error) {
      // The other pages say what failed when they load their own data; the root page has none.
      onboardingFailure = error;
    }
  },
  async loadArrivals(): Promise<void> {
    try {
      arrivals = (await api.get<{ total: number }>('/api/arrivals?limit=1')).total;
    } catch {
      // Same as above.
    }
  },
};
