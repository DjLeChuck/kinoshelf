<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import { isStalled, scanPercent, type ScanProgress } from '../lib/library-items.js';

  let { progress }: { progress: ScanProgress | null } = $props();

  const PHASES = ['discover', 'identify', 'plan'] as const;
  const percent = $derived(scanPercent(progress));
  const phase = $derived(progress?.phase ?? 'discover');
</script>

<div class="card progress" role="status" aria-live="polite">
  <ol class="phases">
    {#each PHASES as step (step)}
      <li class:on={step === phase} aria-current={step === phase ? 'step' : undefined}>
        {t(`web.library.progress.${step}`)}
      </li>
    {/each}
  </ol>

  {#if percent === undefined}
    <progress aria-label={t('web.library.progress.label')}></progress>
  {:else}
    <progress max="100" value={percent} aria-label={t('web.library.progress.label')}
      >{percent}%</progress
    >
  {/if}

  <p class="muted detail">
    {#if progress === null}
      {t('web.library.progress.waiting')}
    {:else if percent === undefined}
      {t('web.library.progress.found', { count: progress.found })}
    {:else}
      {t('web.library.progress.done', { done: progress.done, total: progress.total })}
    {/if}
  </p>
  {#if progress?.current}<p class="muted mono current">{progress.current}</p>{/if}
  {#if isStalled(progress)}<p class="alert">{t('web.library.progress.stalled')}</p>{/if}
</div>

<style>
  .progress {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .phases {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--muted);
  }

  .phases .on {
    color: var(--text);
    font-weight: 600;
  }

  progress {
    width: 100%;
    accent-color: var(--accent);
  }

  p {
    margin: 0;
  }

  .current {
    font-size: 11.5px;
    overflow-wrap: anywhere;
  }
</style>
