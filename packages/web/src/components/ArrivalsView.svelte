<script lang="ts">
  import { untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { resource } from '../lib/resource.svelte.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { t } from '../lib/i18n.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { oneOf } from '../lib/routes.js';
  import {
    QUEUE_CHIP,
    STATUS_LABEL,
    groupReleases,
    readArrivals,
    releaseKey,
    statusOf,
    type Arrival,
    type ArrivalPage,
  } from '../lib/arrivals.js';
  import type { WatchScan, WatchStatus } from '../lib/watch.js';
  import ArrivalDetail from './ArrivalDetail.svelte';

  type Filter = 'all' | 'review' | 'unrecognized';
  const FILTERS: readonly Filter[] = ['all', 'review', 'unrecognized'];

  const PAGE = 50;

  /** How many releases are shown: "Show more" asks for the next ones. */
  let releases = $state(PAGE);
  // In the URL (`?state=review`), like the libraries' filter.
  const filter = $derived<Filter>(oneOf(router.query.get('state'), FILTERS) ?? 'all');
  let shown = untrack(() => filter);
  $effect(() => {
    const current = filter;
    if (current !== shown) {
      shown = current;
      releases = PAGE;
      untrack(() => void load());
    }
  });
  // A slow answer (the other filter's, or an older event's) is dropped by the resource's ticket.
  const loaded = resource(() => {
    const state = filter === 'all' ? '' : `&state=${filter}`;
    return readArrivals(releases, (limit, offset) =>
      api.get<ArrivalPage>(`/api/arrivals?limit=${limit}&offset=${offset}${state}`),
    );
  }, ['arrivals', 'jobs', 'settings', 'ready']);
  const page = $derived(loaded.value);
  const failure = $derived(loaded.failure);
  const load = loaded.reload;

  let chosen = $state<string | undefined>(undefined);
  let notice = $state<string | undefined>(undefined);
  let watch = $state<WatchStatus | undefined>(undefined);
  let checking = $state(false);

  const groups = $derived(groupReleases(page?.items ?? []));
  const open = $derived(
    page?.items.find(({ id }) => id === chosen) ??
      groups[0]?.files[0] ??
      groups[0]?.others[0]?.files[0],
  );
  /** The files that go along with the open one: those of its series in the release. */
  const siblings = $derived(
    open
      ? (page?.items.filter(
          (item) => releaseKey(item) === releaseKey(open) && item.cluster === open.cluster,
        ).length ?? 1)
      : 1,
  );

  /** Whether the open file is of the same series of the same release. */
  function inSeriesOfOpen(arrival: Arrival): boolean {
    return (
      open !== undefined &&
      releaseKey(open) === releaseKey(arrival) &&
      open.cluster === arrival.cluster
    );
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
  async function checkNow(all = false): Promise<void> {
    checking = true;
    try {
      const { submitted, pending } = await api.post<WatchScan>('/api/watch/scan', { all });
      notice = t('web.arrivals.check.done', { submitted, pending });
      loaded.failure = undefined;
    } catch (error) {
      loaded.failure = error;
    } finally {
      checking = false;
    }
    void load();
  }

  refetchOn(['arrivals', 'jobs', 'settings', 'ready'], () => void loadWatch());

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
    <button
      type="button"
      class="btn"
      disabled={!watch?.enabled || checking}
      title={t('web.arrivals.recheck.hint')}
      onclick={() => void checkNow(true)}>{t('web.arrivals.recheck')}</button
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
                  <span class="chip {QUEUE_CHIP[status]}">{t(STATUS_LABEL[status])}</span>
                  {#if group.files.length > 1}<span class="muted"
                      >{t('web.arrivals.files', { count: group.files.length })}</span
                    >{/if}
                  {#if sourceName(lead)}<span class="muted"
                      >{t('web.arrivals.from', { source: sourceName(lead) ?? '' })}</span
                    >{/if}
                </span>
              </button>
            {/if}
            {#if group.others.length > 0}
              <ul
                class="detached"
                aria-label={t('web.arrivals.detached.label', { release: group.name })}
              >
                {#each group.others as other (other.cluster)}
                  {@const arrival = other.files[0]}
                  {#if arrival}
                    {@const status = statusOf(arrival)}
                    <li>
                      <button
                        type="button"
                        class:current={inSeriesOfOpen(arrival)}
                        aria-current={inSeriesOfOpen(arrival) ? 'true' : undefined}
                        onclick={() => {
                          chosen = arrival.id;
                          notice = undefined;
                        }}
                      >
                        <span class="mono release">{arrival.file}</span>
                        <span class="meta">
                          <span class="chip chip-neutral">{t('web.arrivals.detached')}</span>
                          <span class="chip {QUEUE_CHIP[status]}">{t(STATUS_LABEL[status])}</span>
                          {#if other.files.length > 1}<span class="muted"
                              >{t('web.arrivals.files', { count: other.files.length })}</span
                            >{/if}
                          <span class="muted"
                            >{t('web.arrivals.detached.from', { release: group.name })}</span
                          >
                        </span>
                      </button>
                    </li>
                  {/if}
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
        {#if page.total > page.items.length}
          <li>
            <button
              type="button"
              class="btn"
              onclick={() => {
                releases += PAGE;
                void load();
              }}>{t('web.library.more', { shown: page.items.length, total: page.total })}</button
            >
          </li>
        {/if}
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
