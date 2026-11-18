import type { LibraryApi, LibraryBody } from './libraries.js';

/** What `GET /api/onboarding` returns. */
export type StepId = 'tmdb' | 'server' | 'destination' | 'source';
export type StepState = 'todo' | 'done' | 'skipped';

export interface Step {
  readonly id: StepId;
  readonly state: StepState;
  /** Done because the configuration says so: nothing to tick, nothing to reopen. */
  readonly auto: boolean;
}

export interface Onboarding {
  readonly completed: boolean;
  readonly steps: readonly Step[];
}

/** Only an optional step may be skipped: the others are needed to identify and place a file. */
export const SKIPPABLE: readonly StepId[] = ['server'];

/** Steps settled one way or the other: a skipped step no longer holds the user back. */
export const settled = (steps: readonly Step[]): number =>
  steps.filter((step) => step.state !== 'todo').length;

export const allSettled = (steps: readonly Step[]): boolean =>
  steps.length > 0 && settled(steps) === steps.length;

/** The step to do now: the first one still open. */
export const nextStep = (steps: readonly Step[]): StepId | undefined =>
  steps.find((step) => step.state === 'todo')?.id;

/**
 * Creates the libraries of the welcome page (a movie one, a series one, or both: someone may keep
 * only one kind), all or none: sent again after a failure, the step would otherwise find the
 * first folder already taken.
 */
export async function createDestinations(
  api: Pick<LibraryApi, 'create' | 'remove'>,
  ...bodies: readonly LibraryBody[]
): Promise<void> {
  const created: string[] = [];
  try {
    for (const body of bodies) {
      created.push((await api.create(body)).id);
    }
  } catch (error) {
    for (const id of created) {
      await api.remove(id).catch(() => undefined);
    }
    throw error;
  }
}
