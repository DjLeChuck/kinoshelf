<script lang="ts">
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import { allSettled, settled, type Onboarding } from '../lib/onboarding.js';
  import { shell } from '../lib/shell-state.svelte.js';
  import OnboardingSteps from './OnboardingSteps.svelte';

  let { onboarding }: { onboarding: Onboarding } = $props();

  let failure = $state<unknown>(undefined);
  const done = $derived(settled(onboarding.steps));
  const total = $derived(onboarding.steps.length);

  async function finish(): Promise<void> {
    try {
      shell.setOnboarding(await api.patch<Onboarding>('/api/onboarding', { finished: true }));
    } catch (error) {
      failure = error;
    }
  }
</script>

<div class="welcome">
  <div class="main">
    <div class="intro">
      <span class="eyebrow">{t('web.welcome.eyebrow')}</span>
      <h1>{t('web.welcome.title')}</h1>
      <p>{t('web.welcome.intro')}</p>
    </div>

    <div class="progress">
      <div class="muted row">
        <span>{t('web.welcome.progress')}</span>
        <span>{t('web.welcome.progress.count', { done, total })}</span>
      </div>
      <div
        class="bar"
        role="progressbar"
        aria-label={t('web.welcome.progress.label')}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <div class="fill" style:width="{total === 0 ? 0 : (done / total) * 100}%"></div>
      </div>
    </div>

    <OnboardingSteps steps={onboarding.steps} />

    {#if failure}
      <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
    {/if}

    {#if allSettled(onboarding.steps)}
      <div class="ready" role="status">
        <span>{t('web.welcome.ready')}</span>
        <button type="button" class="btn btn-primary" onclick={() => void finish()}>
          {t('web.welcome.finish')}
        </button>
      </div>
    {:else}
      <button type="button" class="btn leave" onclick={() => void finish()}>
        {t('web.welcome.leave')}
      </button>
    {/if}
  </div>

  <aside class="card" aria-labelledby="how-title">
    <h2 id="how-title">{t('web.welcome.how.title')}</h2>
    {#each [1, 2, 3] as const as n (n)}
      <div class="how">
        <span class="n" aria-hidden="true">{n}</span>
        <div>
          <strong>{t(`web.welcome.how.${n}.title`)}</strong>
          <p class="muted">{t(`web.welcome.how.${n}.body`)}</p>
        </div>
      </div>
    {/each}
    <p class="muted safe">{t('web.welcome.how.safe')}</p>
  </aside>
</div>

<style>
  .welcome {
    display: flex;
    flex-wrap: wrap;
    gap: 40px;
    align-items: flex-start;
    max-width: 1120px;
    margin: 0 auto;
  }

  .main {
    display: flex;
    flex: 3 1 520px;
    flex-direction: column;
    gap: 28px;
    min-width: 0;
  }

  .intro {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .eyebrow {
    color: var(--accent-text);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h1 {
    font-size: 34px;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }

  .intro p {
    max-width: 600px;
    font-size: 16px;
    line-height: 1.55;
  }

  .progress {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
  }

  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--border);
  }

  .fill {
    height: 100%;
    border-radius: 3px;
    background: var(--accent);
  }

  .ready {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 24px;
    border: 1px solid var(--ok);
    border-radius: var(--radius);
    background: var(--ok-bg);
    font-weight: 600;
  }

  .leave {
    align-self: flex-start;
  }

  aside {
    flex: 2 1 320px;
    min-width: 0;
    padding: 24px;
  }

  aside h2 {
    font-size: 18px;
  }

  .how {
    display: flex;
    gap: 14px;
  }

  .how p {
    margin: 3px 0 0;
    font-size: 13px;
    line-height: 1.5;
  }

  .n {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--accent-text);
    font-weight: 800;
  }

  .safe {
    margin: 0;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    font-size: 13px;
    line-height: 1.5;
  }
</style>
