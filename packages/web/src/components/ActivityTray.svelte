<script lang="ts">
  import { describeError } from '@kinoshelf/i18n';
  import { activity } from '../lib/activity.svelte.js';
  import {
    isRunning,
    labelOf,
    overallPercent,
    percentOf,
    phaseOf,
    type ActivityTask,
  } from '../lib/activity.js';
  import { t } from '../lib/i18n.svelte.js';
  import Link from './Link.svelte';

  let open = $state(false);

  const tasks = $derived(activity.tasks);
  const running = $derived(tasks.filter(isRunning));
  const overall = $derived(overallPercent(tasks));
  const failed = $derived(tasks.some(({ status }) => status === 'failed'));

  const title = (task: ActivityTask): string => t(labelOf(task), task.params);

  /** What is going on under the title: the phase, the outcome or the cause of a failure. */
  function detail(task: ActivityTask): string {
    if (task.status === 'failed') {
      return task.error ? describeError(t, task.error) : t('web.activity.failed');
    }
    if (task.status === 'done') {
      return t('web.activity.done');
    }
    const phase = phaseOf(task);
    return phase ? t(phase) : '';
  }
</script>

{#if tasks.length > 0}
  <aside class="tray" aria-label={t('web.activity.label')}>
    <button
      type="button"
      class="pill"
      class:failed
      aria-expanded={open}
      aria-controls="activity-list"
      onclick={() => (open = !open)}
    >
      <span class="summary">
        {#if running.length > 0}
          {t('web.activity.running', { count: running.length })}
        {:else}
          {t('web.activity.recent')}
        {/if}
      </span>
      {#if running.length > 0}
        {#if overall === undefined}
          <progress aria-hidden="true"></progress>
        {:else}
          <progress max="100" value={overall} aria-hidden="true"></progress>
        {/if}
      {/if}
      <span class="sr-only">{open ? t('web.activity.collapse') : t('web.activity.expand')}</span>
      <span class="chevron" aria-hidden="true">{open ? '▾' : '▴'}</span>
    </button>

    <div id="activity-list" role="status" aria-live="polite" hidden={!open}>
      <ul>
        {#each tasks as task (task.id)}
          {@const percent = percentOf(task)}
          <li class:failed={task.status === 'failed'} class:done={task.status === 'done'}>
            <div class="head">
              <strong>{title(task)}</strong>
              {#if task.status !== 'running'}
                <button
                  type="button"
                  class="close"
                  aria-label={t('web.activity.dismiss')}
                  onclick={() => {
                    activity.dismiss(task.id);
                  }}>×</button
                >
              {/if}
            </div>
            {#if task.status === 'running'}
              {#if percent === undefined}
                <progress aria-label={title(task)}></progress>
              {:else}
                <progress max="100" value={percent} aria-label={title(task)}>{percent}%</progress>
              {/if}
            {/if}
            <p class="muted line">
              {#if task.status === 'done'}✓{:else if task.status === 'failed'}✗{/if}
              {detail(task)}
              {#if task.status === 'running' && task.done !== null && task.total !== null}
                · {t('web.activity.count', { done: task.done, total: task.total })}
              {/if}
            </p>
            {#if task.status === 'running' && task.current}
              <p class="muted mono line current" title={task.current}>{task.current}</p>
            {/if}
            {#if task.href}
              <Link href={task.href} class="open">{t('web.activity.open')}</Link>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  </aside>
{/if}

<style>
  .tray {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    width: min(360px, calc(100vw - 32px));
  }

  .pill {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 0 14px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 4px 16px rgb(0 0 0 / 25%);
    cursor: pointer;
    font: inherit;
  }

  .pill.failed {
    border-color: var(--danger);
  }

  .summary {
    flex: 1;
    text-align: left;
  }

  .pill progress {
    width: 64px;
  }

  [role='status'] {
    max-height: min(60vh, 480px);
    overflow-y: auto;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: 0 4px 16px rgb(0 0 0 / 25%);
  }

  [role='status'][hidden] {
    display: none;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px;
  }

  li + li {
    border-top: 1px solid var(--border);
  }

  li.failed .line {
    color: var(--danger);
  }

  li.done .line {
    color: var(--ok);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .close {
    min-width: 32px;
    min-height: 32px;
    border: 0;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    font-size: 18px;
  }

  progress {
    width: 100%;
  }

  .line {
    margin: 0;
    font-size: 13px;
  }

  .current {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  li :global(.open) {
    align-self: flex-start;
    font-size: 13px;
  }
</style>
