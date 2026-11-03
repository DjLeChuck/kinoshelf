<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import {
    isStalled,
    scanPercent,
    type ScanProgress,
    type TransferProgress,
  } from '../lib/library-items.js';

  let {
    progress,
    transfer = null,
  }: { progress: ScanProgress | null; transfer?: TransferProgress | null } = $props();

  const PHASES = ['discover', 'identify', 'plan'] as const;
  const percent = $derived(scanPercent(progress));
  const phase = $derived(progress?.phase ?? 'discover');
  const current = $derived(PHASES.indexOf(phase));
</script>

<div class="card progress" role="status" aria-live="polite">
  <ol class="phases">
    {#each PHASES as step, index (step)}
      <li
        class:on={index === current}
        class:past={progress !== null && index < current}
        aria-current={progress !== null && index === current ? 'step' : undefined}
      >
        <span class="marker" aria-hidden="true"
          >{index < current && progress ? '✓' : index + 1}</span
        >
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
    {#if progress === null && transfer}
      {t('web.library.progress.transfer', { done: transfer.done, total: transfer.total })}
    {:else if progress === null}
      {t('web.library.progress.waiting')}
    {:else if progress.phase === 'plan'}
      {t('web.library.progress.planning')}
    {:else if percent === undefined}
      {t('web.library.progress.found', { count: progress.found })}
    {:else}
      {t('web.library.progress.done', { done: progress.done, total: progress.total })}
    {/if}
  </p>
  {#if progress?.phase !== 'plan' && (progress?.current ?? transfer?.current)}<p
      class="muted mono current"
    >
      {progress?.current ?? transfer?.current}
    </p>{/if}
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
    gap: 8px 20px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--muted);
  }

  .phases li {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .marker {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 1px solid currentColor;
    border-radius: 50%;
    font-size: 12px;
  }

  .phases .on {
    color: var(--text);
    font-weight: 600;
  }

  .phases .on .marker {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .phases .past .marker {
    color: var(--accent);
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
