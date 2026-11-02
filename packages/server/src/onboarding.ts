import { destinationRoots, type Config } from '@kinoshelf/core';
import { tmdbApiKey } from '@kinoshelf/provider-tmdb';
import type { Database } from 'better-sqlite3';

const ONBOARDING_STEPS = ['tmdb', 'server', 'destination', 'source'] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];
export type OnboardingMark = 'done' | 'skipped';

export interface OnboardingStep {
  readonly id: OnboardingStepId;
  readonly state: 'todo' | OnboardingMark;
  /** Done because the configuration says so, whatever the user marked. */
  readonly auto: boolean;
}

export interface Onboarding {
  readonly completed: boolean;
  readonly steps: readonly OnboardingStep[];
}

export interface OnboardingFacts {
  readonly config: Config;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** A job or a batch exists: the install has already worked on files. */
  readonly hasWork: boolean;
  readonly marks: ReadonlyMap<string, OnboardingMark>;
}

/**
 * What the configuration already settles. A mark only covers what it cannot see (a server that
 * is optional, a folder submitted from the command line), so a step the user did not do by hand
 * still ticks itself.
 */
function detected(facts: OnboardingFacts): Record<OnboardingStepId, boolean> {
  const { config, env, hasWork } = facts;
  return {
    tmdb: tmdbApiKey(env, config) !== undefined,
    server: config.notify?.plex !== undefined || config.notify?.jellyfin !== undefined,
    // The destinations are the libraries organized in place; the source is an arrival folder.
    destination: destinationRoots(config).length > 0,
    source: hasWork || (config.libraries ?? []).some(({ into }) => into !== undefined),
  };
}

export function onboardingOf(facts: OnboardingFacts): Onboarding {
  const auto = detected(facts);
  return {
    // An install that has already worked is not new, whatever it was never told.
    completed: facts.marks.has('finished') || facts.hasWork,
    steps: ONBOARDING_STEPS.map((id) => {
      const mark = facts.marks.get(id);
      return {
        id,
        state: auto[id] ? 'done' : (mark ?? 'todo'),
        auto: auto[id],
      };
    }),
  };
}

/** What the user ticked or skipped on the welcome page; durable, so it follows them across browsers. */
export class OnboardingStore {
  constructor(private readonly database: Database) {}

  marks(): Map<string, OnboardingMark> {
    return new Map(
      this.database
        .prepare<[], { key: string; state: OnboardingMark }>(
          'SELECT key, state FROM onboarding_state',
        )
        .all()
        .map((row) => [row.key, row.state]),
    );
  }

  /** `null` takes the mark back ("reopen"). */
  mark(key: OnboardingStepId | 'finished', state: OnboardingMark | null): void {
    if (state === null) {
      this.database.prepare('DELETE FROM onboarding_state WHERE key = ?').run(key);
      return;
    }
    this.database
      .prepare(
        `INSERT INTO onboarding_state (key, state, at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET state = excluded.state, at = excluded.at`,
      )
      .run(key, state, new Date().toISOString());
  }
}
