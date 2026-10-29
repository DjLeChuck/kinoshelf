<script lang="ts">
  import QueueDetail from '../components/QueueDetail.svelte';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { t } from '../lib/i18n.svelte.js';
  import {
    STATUS_CHIP,
    STATUS_LABEL,
    folderOf,
    pickSelection,
    releaseName,
    statusOf,
    type QueueEntry,
  } from '../lib/queue.js';

  let entries = $state<readonly QueueEntry[] | undefined>(undefined);
  let failure = $state<unknown>(undefined);
  let chosen = $state<string | undefined>(undefined);
  let notice = $state<string | undefined>(undefined);

  const open = $derived(
    entries?.find((entry) => entry.id === pickSelection(entries ?? [], chosen)),
  );

  async function load(): Promise<void> {
    try {
      entries = await api.get<QueueEntry[]>('/api/queue?limit=200');
      failure = undefined;
    } catch (error) {
      failure = error;
    }
  }

  // The server says when the queue changes (a job ends, a file is validated elsewhere).
  refetchOn(['queue', 'jobs', 'ready'], () => void load());
</script>

<div class="page">
  <div class="head">
    <h1>{t('web.queue.title')}</h1>
    <p class="muted">{t('web.queue.intro')}</p>
  </div>

  {#if notice}
    <p class="alert notice" role="status">{notice}</p>
  {/if}

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {:else if entries === undefined}
    <p class="muted" role="status">{t('web.loading')}</p>
  {:else if entries.length === 0}
    <p class="card muted">{t('web.queue.empty')}</p>
  {:else}
    <div class="layout">
      <ul class="list" aria-label={t('web.queue.list.label')}>
        {#each entries as entry (entry.id)}
          {@const status = statusOf(entry)}
          <li>
            <button
              type="button"
              class:current={open?.id === entry.id}
              aria-current={open?.id === entry.id ? 'true' : undefined}
              onclick={() => (chosen = entry.id)}
            >
              <span class="mono name">{releaseName(entry.path)}</span>
              <span class="muted mono where">{folderOf(entry.path)}</span>
              <span class="chip {STATUS_CHIP[status]}">{t(STATUS_LABEL[status])}</span>
            </button>
          </li>
        {/each}
      </ul>

      <div>
        {#if open}
          {#key open.id}
            <QueueDetail
              entry={open}
              ondone={(message: string) => {
                notice = message;
                void load();
              }}
            />
          {/key}
        {:else}
          <p class="muted">{t('web.queue.select')}</p>
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

  .name {
    font-weight: 600;
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
