<script lang="ts">
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import {
    STATUS_CHIP as BATCH_CHIP,
    formatDate,
    originOf,
    type BatchSummary,
  } from '../lib/history.js';
  import {
    activityOf,
    failureCount,
    queueLabel,
    recentFailure,
    servicesOf,
    suggestsServer,
    weekCount,
  } from '../lib/home.js';
  import { folderOf, releaseName, STATUS_CHIP, STATUS_LABEL, statusOf } from '../lib/queue.js';
  import type { Settings } from '../lib/settings.js';
  import { shell } from '../lib/shell-state.svelte.js';
  import Link from './Link.svelte';

  const FIRST_FILES = 3;
  const ACTIVITY = 5;

  let batches = $state<readonly BatchSummary[] | undefined>(undefined);
  let settings = $state<Settings | undefined>(undefined);
  let failure = $state<unknown>(undefined);

  async function load(): Promise<void> {
    try {
      [batches, settings] = await Promise.all([
        api.get<BatchSummary[]>('/api/batches?limit=50'),
        api.get<Settings>('/api/settings'),
      ]);
      failure = undefined;
    } catch (error) {
      failure = error;
    }
  }

  refetchOn(['history', 'settings', 'ready'], () => void load());

  const queue = $derived(shell.queue ?? []);
  // A snapshot per load is enough: "this week" does not need to tick.
  const now = $derived(batches === undefined ? 0 : Date.now());
  const failed = $derived(batches && recentFailure(batches, now));
</script>

<div class="home">
  <div class="head">
    <h1>{t('web.home.greeting')}</h1>
    <p class="muted">{t('web.home.intro')}</p>
  </div>

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {/if}

  {#if shell.queue !== undefined}
    {#if queue.length > 0}
      <section class="todo card" aria-labelledby="todo-title">
        <div class="todo-text">
          <span class="eyebrow">{t('web.home.todo.eyebrow')}</span>
          <h2 id="todo-title">{t('web.home.todo.title', { count: queueLabel(queue.length) })}</h2>
          <p class="muted">{t('web.home.todo.body')}</p>
          <div>
            <Link href="/queue" class="btn btn-primary">{t('web.home.todo.cta')}</Link>
          </div>
        </div>
        <ul class="files" aria-label={t('web.home.todo.list')}>
          {#each queue.slice(0, FIRST_FILES) as entry (entry.id)}
            {@const status = statusOf(entry)}
            <li>
              <span class="mono" title={folderOf(entry.path)}>{releaseName(entry.path)}</span>
              <span class="chip {STATUS_CHIP[status]}">{t(STATUS_LABEL[status])}</span>
            </li>
          {/each}
          {#if queue.length > FIRST_FILES}
            <li class="muted more">
              {t('web.home.todo.more', { count: queue.length - FIRST_FILES })}
            </li>
          {/if}
        </ul>
      </section>
    {:else}
      <section class="card clear">
        <h2>{t('web.home.clear.title')}</h2>
        <p class="muted">{t('web.home.clear.body')}</p>
      </section>
    {/if}
  {/if}

  {#if failed || (settings && suggestsServer(settings))}
    <div class="notices">
      {#if failed}
        <Link href="/history" class="card notice danger">
          <span class="eyebrow danger-text">{t('web.home.failed.eyebrow')}</span>
          <strong>{t('web.home.failed.title', { count: failed.failed })}</strong>
          <span class="muted">
            {t('web.home.failed.body', { date: formatDate(failed.at, locale.value) })}
          </span>
          <span class="cta">{t('web.home.failed.cta')}</span>
        </Link>
      {/if}
      {#if settings && suggestsServer(settings)}
        <Link href="/settings" class="card notice">
          <span class="eyebrow muted">{t('web.home.suggest.eyebrow')}</span>
          <strong>{t('web.home.suggest.title')}</strong>
          <span class="muted">{t('web.home.suggest.body')}</span>
          <span class="cta">{t('web.home.suggest.cta')}</span>
        </Link>
      {/if}
    </div>
  {/if}

  <div class="columns">
    <section class="card activity" aria-labelledby="activity-title">
      <div class="activity-head">
        <h2 id="activity-title">{t('web.home.activity.title')}</h2>
        <Link href="/history">{t('web.home.activity.all')}</Link>
      </div>
      {#if batches === undefined}
        <p class="muted" role="status">{t('web.loading')}</p>
      {:else if batches.length === 0}
        <p class="muted">{t('web.home.activity.empty')}</p>
      {:else}
        <ul>
          {#each batches.slice(0, ACTIVITY) as batch (batch.id)}
            {@const line = activityOf(batch)}
            <li>
              <span class="dot {BATCH_CHIP[batch.status]}" aria-hidden="true"></span>
              <span class="what">
                <span>{t(line.key, { count: line.count })}</span>
                <span class="muted small">
                  {formatDate(batch.at, locale.value)}{originOf(batch)
                    ? ` · ${originOf(batch)}`
                    : ''}
                </span>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <div class="side">
      {#if batches !== undefined}
        <section class="stats" aria-label={t('web.home.stats.label')}>
          <div>
            <strong>{queueLabel(queue.length)}</strong>
            <span class="muted">{t('web.home.stats.queue')}</span>
          </div>
          <div>
            <strong>{weekCount(batches, now)}</strong>
            <span class="muted">{t('web.home.stats.week')}</span>
          </div>
          <div>
            <strong>{failureCount(batches, now)}</strong>
            <span class="muted">{t('web.home.stats.failed')}</span>
          </div>
        </section>
      {/if}

      {#if settings}
        <section class="card" aria-labelledby="services-title">
          <h2 id="services-title">{t('web.home.services.title')}</h2>
          {#each servicesOf(settings) as service (service.id)}
            <div class="service">
              <span>
                {service.id === 'watch'
                  ? t('web.home.services.watch')
                  : service.id === 'tmdb'
                    ? 'TMDB'
                    : service.id === 'plex'
                      ? 'Plex'
                      : 'Jellyfin'}
              </span>
              <span class="chip {service.on ? 'chip-ok' : 'chip-neutral'}">
                {#if service.id === 'watch'}
                  {t(service.on ? 'web.home.services.active' : 'web.home.services.inactive')}
                {:else}
                  {t(service.on ? 'web.home.services.configured' : 'web.home.services.missing')}
                {/if}
              </span>
            </div>
          {/each}
        </section>
      {/if}
    </div>
  </div>
</div>

<style>
  .home {
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .head h1 {
    font-size: 30px;
    letter-spacing: -0.02em;
  }

  .head p {
    margin: 6px 0 0;
    font-size: 16px;
  }

  h2 {
    font-size: 16px;
  }

  .eyebrow {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .todo {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 24px;
    padding: 24px;
    border-color: var(--accent);
  }

  .todo .eyebrow {
    color: var(--accent-text);
  }

  .todo-text {
    display: flex;
    flex: 1 1 320px;
    flex-direction: column;
    gap: 10px;
    justify-content: center;
  }

  .todo h2 {
    font-size: 24px;
    line-height: 1.25;
  }

  .todo p {
    margin: 0;
    line-height: 1.5;
  }

  .files {
    display: flex;
    flex: 1 1 380px;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .files li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--bg);
  }

  .files .more {
    justify-content: center;
    background: none;
    font-size: 13px;
  }

  .notices {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 16px;
  }

  .notices :global(.notice) {
    gap: 8px;
    color: var(--text);
    text-decoration: none;
  }

  .notices :global(.notice.danger) {
    border-color: var(--danger);
  }

  .danger-text {
    color: var(--danger);
  }

  .cta {
    padding-top: 4px;
    color: var(--accent-text);
    font-weight: 600;
  }

  .columns {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    align-items: flex-start;
  }

  .activity {
    flex: 2 1 480px;
    min-width: 0;
    padding: 0;
    gap: 0;
    overflow: hidden;
  }

  .activity-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }

  .activity ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .activity li {
    display: flex;
    gap: 14px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--surface-2);
  }

  .activity li:last-child {
    border-bottom: 0;
  }

  .activity p {
    margin: 0;
    padding: 16px 20px;
  }

  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    margin-top: 6px;
    padding: 0;
    border-radius: 50%;
    background: currentcolor;
  }

  .what {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .small {
    font-size: 12.5px;
    word-break: break-all;
  }

  .side {
    display: flex;
    flex: 1 1 280px;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--border);
  }

  .stats div {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 16px;
    background: var(--surface);
  }

  .stats strong {
    font-size: 24px;
    font-weight: 800;
  }

  .stats span {
    font-size: 12.5px;
  }

  .service {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
</style>
