<script lang="ts">
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import Link from './Link.svelte';
  import {
    STATUS_CHIP,
    canUndo,
    formatDate,
    originOf,
    tally,
    type BatchDetail,
    type UndoReport,
  } from '../lib/history.js';
  import { shortId } from '../lib/job.js';
  import { releaseName } from '../lib/queue.js';
  import type { ErrorBody } from '../lib/queue.js';

  let {
    id,
    ondone,
  }: {
    id: string;
    /** The batch was undone: what to tell the user. */
    ondone: (message: string) => void;
  } = $props();

  let batch = $state<BatchDetail | undefined>(undefined);
  let failure = $state<unknown>(undefined);
  let preview = $state<UndoReport | undefined>(undefined);
  let busy = $state(false);

  // The parent keys this component on the batch, so `id` does not change during its life.
  refetchOn(['history', 'ready'], () => void load());

  async function load(): Promise<void> {
    try {
      batch = await api.get<BatchDetail>(`/api/batches/${id}`);
      failure = undefined;
    } catch (error) {
      failure = error;
    }
  }

  const describe = (error: ErrorBody): string =>
    messageOf(t, { code: error.code, params: error.params });

  async function check(): Promise<void> {
    busy = true;
    failure = undefined;
    try {
      preview = await api.post<UndoReport>(`/api/batches/${id}/undo`, { dryRun: true });
    } catch (error) {
      failure = error;
    } finally {
      busy = false;
    }
  }

  async function confirm(): Promise<void> {
    busy = true;
    failure = undefined;
    try {
      const report = await api.post<UndoReport>(`/api/batches/${id}/undo`, { dryRun: false });
      preview = undefined;
      ondone(t('web.history.undo.result', tally(report)));
      await load();
    } catch (error) {
      failure = error;
    } finally {
      busy = false;
    }
  }
</script>

{#if failure && !batch}
  <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
{:else if batch}
  <article class="card">
    <header>
      <div>
        <h2>{formatDate(batch.at, locale.value)}</h2>
        {#if originOf(batch)}
          <p class="muted">
            {t('web.history.submitted')}: <span class="mono">{originOf(batch)}</span>
            {#if batch.origin}·
              <Link href={`/jobs/${batch.origin.jobId}`}
                >{t('web.history.from-job', { id: shortId(batch.origin.jobId) })}</Link
              >{/if}
          </p>
        {:else}
          <p class="muted">{t('web.history.origin.cli')}</p>
        {/if}
      </div>
      <span class="chip {STATUS_CHIP[batch.status]}">{t(`web.history.status.${batch.status}`)}</span
      >
    </header>

    {#if batch.error}
      <p class="alert alert-danger">{describe(batch.error)}</p>
    {/if}

    <section aria-labelledby="items-title">
      <h3 id="items-title">{t('web.history.items')}</h3>
      <ul class="items">
        {#each batch.items as item (`${item.source}->${item.destination}`)}
          <li>
            <div class="row">
              <strong class="mono">{releaseName(item.source)}</strong>
              <span class="chip chip-neutral">{t(`web.history.mode.${item.mode}`)}</span>
              <span class="chip {STATUS_CHIP[item.status]}"
                >{t(`web.history.item.${item.status}`)}</span
              >
            </div>
            <p class="muted mono">
              <span class="label">{t('web.history.from')}</span>
              {item.source}
            </p>
            {#if item.destination}
              <p class="muted mono">
                <span class="label">{t('web.history.to')}</span>
                {item.destination}
              </p>
            {/if}
            {#if item.error}<p class="alert alert-danger">{describe(item.error)}</p>{/if}
          </li>
        {/each}
      </ul>
    </section>

    {#if batch.extras.length > 0}
      <section aria-labelledby="extras-title">
        <h3 id="extras-title">{t('web.history.extras')}</h3>
        <p class="muted">{t('web.history.extras.hint')}</p>
        <ul class="items">
          {#each batch.extras as extra (extra.destination)}
            <li>
              <div class="row">
                <strong class="mono">{releaseName(extra.destination)}</strong>
                <span class="chip chip-neutral">{t(`web.history.extra.${extra.kind}`)}</span>
              </div>
              <p class="muted mono">{extra.destination}</p>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if preview}
      <section aria-labelledby="undo-title" aria-live="polite">
        <h3 id="undo-title">{t('web.history.undo.preview')}</h3>
        <p class="muted">{t('web.history.undo.hint')}</p>
        <ul class="items">
          {#each preview.entries as entry (entry.destination)}
            <li>
              <div class="row">
                <strong class="mono">{releaseName(entry.destination)}</strong>
                <span
                  class="chip {entry.status === 'undone'
                    ? 'chip-ok'
                    : entry.status === 'skipped'
                      ? 'chip-warn'
                      : 'chip-danger'}">{t(`web.history.undo.${entry.status}`)}</span
                >
              </div>
              {#if entry.error}<p class="muted">{describe(entry.error)}</p>{/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if failure}
      <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
    {/if}

    {#if batch.status === 'failed'}
      <p class="muted">{t('web.history.nothing-to-undo')}</p>
    {:else if batch.status === 'undone'}
      <p class="muted">{t('web.history.already-undone')}</p>
    {:else if canUndo(batch)}
      <footer>
        {#if preview}
          <button
            type="button"
            class="btn btn-primary"
            disabled={busy}
            onclick={() => void confirm()}
          >
            {busy ? t('web.history.undo.running') : t('web.history.undo.confirm')}
          </button>
          <button type="button" class="btn" disabled={busy} onclick={() => (preview = undefined)}>
            {t('web.history.undo.cancel')}
          </button>
        {:else}
          <button type="button" class="btn" disabled={busy} onclick={() => void check()}>
            {busy ? t('web.history.undo.checking') : t('web.history.undo')}
          </button>
        {/if}
      </footer>
    {/if}
  </article>
{:else}
  <p class="muted" role="status">{t('web.loading')}</p>
{/if}

<style>
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  h2 {
    font-size: 16px;
  }

  h3 {
    margin-bottom: 8px;
    font-size: 13px;
    color: var(--muted);
    font-weight: 600;
  }

  .items {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .items li {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .row strong {
    flex: 1;
    min-width: 0;
  }

  .label {
    font-family: var(--font);
    font-weight: 600;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
</style>
