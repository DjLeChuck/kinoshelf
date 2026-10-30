<script lang="ts">
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import { SKIPPABLE, nextStep, type Onboarding, type Step } from '../lib/onboarding.js';
  import { shell } from '../lib/shell-state.svelte.js';
  import OnboardingStepForm from './OnboardingStepForm.svelte';

  let { steps }: { steps: readonly Step[] } = $props();

  let failure = $state<unknown>(undefined);
  const next = $derived(nextStep(steps));

  async function mark(step: Step, state: 'done' | 'skipped' | null): Promise<void> {
    try {
      shell.setOnboarding(await api.patch<Onboarding>('/api/onboarding', { step: step.id, state }));
      failure = undefined;
    } catch (error) {
      failure = error;
    }
  }
</script>

{#if failure}
  <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
{/if}

<ol aria-label={t('web.welcome.steps.label')}>
  {#each steps as step, index (step.id)}
    {@const settled = step.state !== 'todo'}
    <li class:next={next === step.id} class:settled>
      <span class="badge" class:done={step.state === 'done'} aria-hidden="true">
        {step.state === 'done' ? '✓' : index + 1}
      </span>
      <div class="text">
        <span class="title">
          {t(`web.onboarding.step.${step.id}.title`)}
          {#if step.state === 'skipped'}
            <span class="chip chip-neutral">{t('web.onboarding.skipped')}</span>
          {/if}
        </span>
        <span class="muted">{t(`web.onboarding.step.${step.id}.body`)}</span>
      </div>
      <div class="actions">
        {#if !step.auto}
          {#if settled}
            <button type="button" class="btn" onclick={() => void mark(step, null)}>
              {t('web.onboarding.reopen')}
            </button>
          {:else}
            <button type="button" class="btn" onclick={() => void mark(step, 'done')}>
              {t('web.onboarding.mark-done')}
            </button>
            {#if SKIPPABLE.includes(step.id)}
              <button type="button" class="btn" onclick={() => void mark(step, 'skipped')}>
                {t('web.onboarding.skip')}
              </button>
            {/if}
          {/if}
        {/if}
      </div>
      {#if next === step.id}
        <OnboardingStepForm step={step.id} />
      {/if}
    </li>
  {/each}
</ol>

<style>
  ol {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    padding: 18px 20px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  li.next {
    border-color: var(--accent);
  }

  li.settled {
    opacity: 0.75;
  }

  .badge {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--muted);
    font-weight: 800;
  }

  .next .badge {
    background: var(--accent);
    color: var(--on-accent);
  }

  .badge.done {
    background: var(--ok);
    color: var(--on-accent);
  }

  .text {
    display: flex;
    flex: 1 1 240px;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    font-size: 13.5px;
    line-height: 1.5;
  }

  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    font-weight: 700;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
