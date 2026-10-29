<script lang="ts">
  import BatchDetail from '../components/BatchDetail.svelte';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import { STATUS_CHIP, formatDate, originOf, type BatchSummary } from '../lib/history.js';

  let batches = $state<readonly BatchSummary[] | undefined>(undefined);
  let failure = $state<unknown>(undefined);
  let chosen = $state<string | undefined>(undefined);
  let notice = $state<string | undefined>(undefined);

  const open = $derived(batches?.find((batch) => batch.id === chosen) ?? batches?.[0]);

  async function load(): Promise<void> {
    try {
      batches = await api.get<BatchSummary[]>('/api/batches?limit=200');
      failure = undefined;
    } catch (error) {
      failure = error;
    }
  }

  refetchOn(['history', 'ready'], () => void load());
</script>

<div class="page">
  <div class="head">
    <h1>{t('web.history.title')}</h1>
    <p class="muted">{t('web.history.intro')}</p>
  </div>

  {#if notice}
    <p class="alert notice" role="status">{notice}</p>
  {/if}

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {:else if batches === undefined}
    <p class="muted" role="status">{t('web.loading')}</p>
  {:else if batches.length === 0}
    <p class="card muted">{t('web.history.empty')}</p>
  {:else}
    <div class="layout">
      <ul class="list" aria-label={t('web.history.list.label')}>
        {#each batches as batch (batch.id)}
          <li>
            <button
              type="button"
              class:current={open?.id === batch.id}
              aria-current={open?.id === batch.id ? 'true' : undefined}
              onclick={() => {
                chosen = batch.id;
                notice = undefined;
              }}
            >
              <span class="top">
                <strong>{formatDate(batch.at, locale.value)}</strong>
                <span class="chip {STATUS_CHIP[batch.status]}"
                  >{t(`web.history.status.${batch.status}`)}</span
                >
              </span>
              <span class="muted mono where">{originOf(batch) ?? t('web.history.origin.cli')}</span>
              <span class="muted">
                {t('web.history.files', { count: batch.operations })}
                {#if batch.failed > 0}· {t('web.history.failed-files', {
                    count: batch.failed,
                  })}{/if}
                {#if batch.modes.length > 0}
                  · {batch.modes.map((mode) => t(`web.history.mode.${mode}`)).join(', ')}
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>

      <div>
        {#if open}
          {#key open.id}
            <BatchDetail
              id={open.id}
              ondone={(message: string) => {
                notice = message;
              }}
            />
          {/key}
        {:else}
          <p class="muted">{t('web.history.select')}</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  h1 {
    font-size: 22px;
    margin-bottom: 4px;
  }

  .notice {
    color: var(--ok);
    background: var(--ok-bg);
    border-color: var(--ok);
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(260px, 380px) 1fr;
    gap: 16px;
    align-items: start;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .list button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    width: 100%;
    min-height: 44px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    text-align: left;
    cursor: pointer;
  }

  .list button:hover {
    background: var(--surface-2);
  }

  .list button.current {
    border-color: var(--accent);
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
  }

  .where {
    font-size: 11px;
  }

  @media (max-width: 860px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
