import type { FastifyInstance } from 'fastify';
import type { EventBus } from './events.js';
import {
  onboardingOf,
  type Onboarding,
  type OnboardingMark,
  type OnboardingStepId,
  type OnboardingStore,
} from './onboarding.js';
import { errorSchema, onboardingPatchSchema, onboardingSchema } from './schemas.js';
import type { ConfigStore } from './settings.js';

export interface OnboardingContext {
  readonly store: OnboardingStore;
  readonly config: ConfigStore;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly events: EventBus;
  /** True once a job or a batch exists. */
  readonly hasWork: () => boolean;
}

interface Patch {
  step?: OnboardingStepId;
  state?: OnboardingMark | null;
  finished?: true;
}

/** The welcome page's progress: what the configuration settles, plus what the user marked. */
export function registerOnboardingRoutes(api: FastifyInstance, ctx: OnboardingContext): void {
  const present = (): Onboarding =>
    onboardingOf({
      config: ctx.config.config,
      env: ctx.env,
      hasWork: ctx.hasWork(),
      marks: ctx.store.marks(),
    });

  api.get(
    '/api/onboarding',
    {
      schema: {
        summary: 'Progress of the first-launch setup',
        response: { 200: onboardingSchema, 401: errorSchema },
      },
    },
    present,
  );

  api.patch<{ Body: Patch }>(
    '/api/onboarding',
    {
      schema: {
        summary: 'Mark a step done or skipped, reopen it, or finish the welcome page',
        description:
          '`{ step, state }` with `state` `null` to reopen; `{ finished: true }` leaves the ' +
          'welcome page for good.',
        body: onboardingPatchSchema,
        response: { 200: onboardingSchema, 400: errorSchema, 401: errorSchema },
      },
    },
    (request) => {
      const { step, state, finished } = request.body;
      if (finished === true) {
        ctx.store.mark('finished', 'done');
      } else if (step !== undefined && state !== undefined) {
        ctx.store.mark(step, state);
      }
      ctx.events.emit('settings');
      return present();
    },
  );
}
