<script lang="ts">
  import { untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { t } from '../lib/i18n.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { oneOf } from '../lib/routes.js';
  import {
    STATUS_CHIP,
    STATUS_LABEL,
    groupReleases,
    statusOf,
    type Arrival,
    type ArrivalPage,
  } from '../lib/arrivals.js';
  import type { WatchScan, WatchStatus } from '../lib/watch.js';
  import ArrivalDetail from './ArrivalDetail.svelte';

  type Filter = 'all' | 'review' | 'unrecognized';
  const FILTERS: readonly Filter[] = ['all', 'review', 'unrecognized'];

  let page = $state<ArrivalPage | undefined>(undefined);
  let failure = $state<unknown>(undefined);
  // In the URL (`?state=review`), like the libraries' filter.
  const filter = $derived<Filter>(oneOf(router.query.get('state'), FILTERS) ?? 'all');
  let shown = untrack(() => filter);
  $effect(() => {
    const current = filter;
    if (current !== shown) {
      shown = current;
      untrack(() => void load());
    }
  });
  let chosen = $state<string | undefined>(undefined);
  let notice = $state<string | undefined>(undefined);
  let watch = $state<WatchStatus | undefined>(undefined);
  let checking = $state(false);

  const groups = $derived(groupReleases(page?.items ?? []));
  const open = $derived(
    page?.items.find(({ id }) => id === chosen) ?? groups[0]?.files[0] ?? groups[0]?.detached[0],
  );
  /** The files that go along with the open one: its release's, none when it was set aside. */
  const siblings = $derived(
    open && !open.detached
      ? (groups.find((group) => group.files.some(({ id }) => id === open.id))?.files.length ?? 1)
      : 1,
  );

  async function load(): Promise<void> {
    try {
      page = await api.get<ArrivalPage>(
        `/api/arrivals?limit=200${filter === 'all' ? '' : `&state=${filter}`}`,
      );
      failure = undefined;
    } catch (error) {
      failure = error;
    }
  }

  async function loadWatch(): Promise<void> {
    try {
      watch = await api.get<WatchStatus>('/api/watch');
    } catch {
      // The button stays disabled; the list above reports a real outage.
      watch = undefined;
    }
  }

  /** Skips the settling time: whoever clicks knows the downloads are finished. */
  async function checkNow(): Promise<void> {
    checking = true;
    try {
      const { submitted, pending } = await api.post<WatchScan>('/api/watch/scan');
      notice = t('web.arrivals.check.done', { submitted, pending });
      failure = undefined;
    } catch (error) {
      failure = error;
    } finally {
      checking = false;
    }
    void load();
  }

  refetchOn(['arrivals', 'jobs', 'settings', 'ready'], () => {
    void load();
    void loadWatch();
  });

  const sourceName = (arrival: Arrival): string | undefined =>
    page?.sources.find(({ id }) => id === arrival.sourceId)?.name;
</script>

<div class="stack">
  <div class="intro">
    <p class="muted">{t('web.arrivals.intro')}</p>
    <button
      type="button"
      class="btn"
      disabled={!watch?.enabled || checking}
      title={watch?.enabled ? undefined : t('web.arrivals.check.none')}
      onclick={() => void checkNow()}>{t('web.arrivals.check')}</button
    >
  </div>

  <div class="filters" role="group" aria-label={t('web.arrivals.filter.label')}>
    {#each FILTERS as option (option)}
      <button
        type="button"
        class="btn"
        aria-pressed={filter === option}
        onclick={() => {
          router.setQuery({ state: option === 'all' ? undefined : option });
        }}>{t(`web.arrivals.filter.${option}`)}</button
      >
    {/each}
  </div>

  {#if notice}<p class="alert notice" role="status">{notice}</p>{/if}

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {:else if page === undefined}
    <p class="muted" role="status">{t('web.loading')}</p>
  {:else if page.items.length === 0}
    <p class="card muted">{t('web.arrivals.empty')}</p>
  {:else}
    <div class="layout">
      <ul class="list" aria-label={t('web.arrivals.list.label')}>
        {#each groups as group (group.key)}
          {@const lead = group.files[0]}
          <li>
            {#if lead}
              {@const status = statusOf(lead)}
              <button
                type="button"
                class:current={open?.id !== undefined && group.files.some((f) => f.id === open.id)}
                aria-current={group.files.some((f) => f.id === open?.id) ? 'true' : undefined}
                onclick={() => {
                  chosen = lead.id;
                  notice = undefined;
                }}
              >
                <span class="mono release">{group.name}</span>
                <span class="meta">
                  <span class="chip {STATUS_CHIP[status]}">{t(STATUS_LABEL[status])}</span>
                  {#if group.files.length > 1}<span class="muted"
                      >{t('web.arrivals.files', { count: group.files.length })}</span
                    >{/if}
                  {#if sourceName(lead)}<span class="muted"
                      >{t('web.arrivals.from', { source: sourceName(lead) ?? '' })}</span
                    >{/if}
                </span>
              </button>
            {/if}
            {#if group.detached.length > 0}
              <ul
                class="detached"
                aria-label={t('web.arrivals.detached.label', { release: group.name })}
              >
                {#each group.detached as arrival (arrival.id)}
                  {@const status = statusOf(arrival)}
                  <li>
                    <button
                      type="button"
                      class:current={open?.id === arrival.id}
                      aria-current={open?.id === arrival.id ? 'true' : undefined}
                      onclick={() => {
                        chosen = arrival.id;
                        notice = undefined;
                      }}
                    >
                      <span class="mono release">{arrival.file}</span>
                      <span class="meta">
                        <span class="chip chip-neutral">{t('web.arrivals.detached')}</span>
                        <span class="chip {STATUS_CHIP[status]}">{t(STATUS_LABEL[status])}</span>
                        <span class="muted"
                          >{t('web.arrivals.detached.from', { release: group.name })}</span
                        >
                      </span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>

      <div>
        {#if open}
          {#key open.id}
            <ArrivalDetail
              entry={open}
              {siblings}
              ondone={(message: string) => {
                notice = message;
                void load();
              }}
            />
          {/key}
        {:else}
          <p class="muted">{t('web.arrivals.select')}</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .intro {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .intro p {
    margin: 0;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .filters [aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--surface-2);
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
    gap: 6px;
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

  .release {
    font-size: 12.5px;
    overflow-wrap: anywhere;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .detached {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 6px 0 0 16px;
    padding: 0 0 0 10px;
    border-left: 2px solid var(--border);
    list-style: none;
  }

  @media (max-width: 860px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
