<script lang="ts">
  import { messageOf } from '../lib/errors.js';
  import { untrack } from 'svelte';
  import { refetchOn } from '../lib/events.svelte.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import { formatDate } from '../lib/history.js';
  import { libraryApi, type Library } from '../lib/libraries.js';
  import { router } from '../lib/router.svelte.js';
  import { oneOf } from '../lib/routes.js';
  import {
    ITEM_FILTERS,
    PAGE_SIZE,
    SERIES_FILTERS,
    canRun,
    partition,
    lastScanFailed,
    libraryItems,
    scanPercent,
    type ItemState,
    type ItemsPage,
  } from '../lib/library-items.js';
  import ItemPanel from './ItemPanel.svelte';
  import RunDialog from './RunDialog.svelte';
  import Link from './Link.svelte';
  import ScanProgress from './ScanProgress.svelte';
  import ShowsTree from './ShowsTree.svelte';
  import { episodeLabel } from '../lib/library-items.js';

  let { library }: { library: Library } = $props();

  const STATE_CHIP: Record<ItemState, string> = {
    review: 'chip-warn',
    rename: 'chip-neutral',
    unrecognized: 'chip-danger',
    incomplete: 'chip-neutral',
    ok: 'chip-ok',
  };

  let page = $state<ItemsPage | undefined>(undefined);
  let failure = $state<unknown>(undefined);
  let query = $state('');
  let limit = $state(PAGE_SIZE);
  let chosen = $state<string | undefined>(undefined);
  let notice = $state<string | undefined>(undefined);
  let starting = $state(false);
  let picked = $state<readonly string[]>([]);
  let running = $state<'rename' | 'refresh' | undefined>(undefined);

  const pickedItems = $derived((page?.items ?? []).filter(({ id }) => picked.includes(id)));
  const split = $derived(partition(pickedItems));
  const toRun = $derived.by(() => {
    const mode = running;
    return mode === undefined ? [] : pickedItems.filter(({ id }) => split[mode].includes(id));
  });

  function pick(id: string, on: boolean): void {
    picked = on ? [...picked, id] : picked.filter((other) => other !== id);
  }

  // A series library reads as a tree of shows, until a filter asks for the files themselves
  // (the ones to validate, to rename, without NFO…): then it is the same flat list as the movies'.
  const isSeries = $derived(library.type === 'series');
  const filters = $derived(isSeries ? SERIES_FILTERS : ITEM_FILTERS);
  // The filter lives in the URL (`?state=review`): a link keeps it, and so does a reload.
  const filter = $derived(oneOf(router.query.get('state'), filters));
  let shown = untrack(() => filter);
  $effect(() => {
    const current = filter;
    if (current !== shown) {
      shown = current;
      untrack(refilter);
    }
  });
  const tree = $derived(
    isSeries &&
      (filter === undefined || filter === 'missing-episodes' || filter === 'missing-show-files'),
  );

  const open = $derived(page?.items.find(({ id }) => id === chosen));
  const scanning = $derived(page?.scan != null || library.scanning);
  const percent = $derived(scanPercent(page?.scan?.progress ?? null));

  let latest = 0;
  async function load(): Promise<void> {
    const ticket = ++latest;
    try {
      // The tree reads its shows itself: here only the counts and the scan are wanted.
      const answer = await libraryItems.page(library.id, {
        state:
          filter === 'missing-episodes' || filter === 'missing-show-files' ? undefined : filter,
        q: query,
        limit: tree ? 1 : limit,
      });
      if (ticket === latest) {
        page = answer;
        failure = undefined;
      }
    } catch (error) {
      if (ticket === latest) {
        failure = error;
      }
    }
  }

  refetchOn(['jobs', 'arrivals', 'history', 'settings', 'ready'], () => void load());

  // A running scan moves twice a second: only its progress is read again, not the counts and the
  // list (the `jobs` event reloads them once it ends). One read at a time.
  let following = false;
  async function follow(): Promise<void> {
    const scan = page?.scan;
    if (!scan || following) {
      return;
    }
    following = true;
    const ticket = latest;
    try {
      const job = await libraryItems.scan(scan.jobId);
      const current = page?.scan;
      if (
        ticket === latest &&
        page &&
        current?.jobId === scan.jobId &&
        (job.status === 'queued' || job.status === 'running')
      ) {
        page = { ...page, scan: { ...current, status: job.status, progress: job.progress } };
      }
    } catch {
      // The next full load says what went wrong.
    } finally {
      following = false;
    }
  }

  refetchOn(['progress'], () => void follow());

  async function scan(): Promise<void> {
    starting = true;
    failure = undefined;
    try {
      await libraryApi.scan(library.id);
      await load();
    } catch (error) {
      failure = error;
    } finally {
      starting = false;
    }
  }

  function refilter(): void {
    limit = PAGE_SIZE;
    // What was picked under another filter or search is no longer on screen to be unpicked.
    picked = [];
    void load();
  }
</script>

<div class="stack">
  <div class="head">
    <div>
      <h2>{library.name}</h2>
      <p class="muted mono path">{library.source}</p>
      <p class="muted">
        {#if page?.scannedAt}
          {t('web.library.scanned', { date: formatDate(page.scannedAt, locale.value) })}
        {:else if page}
          {t('web.library.never')}
        {/if}
      </p>
    </div>
    <button
      type="button"
      class="btn btn-primary"
      disabled={scanning || starting}
      onclick={() => void scan()}
    >
      {#if scanning}
        {percent === undefined
          ? t('web.library.scan.running')
          : t('web.library.scan.running.percent', { percent })}
      {:else}
        {t('web.library.scan')}
      {/if}
    </button>
  </div>

  {#if lastScanFailed(library)}
    <p class="alert alert-danger" role="alert">
      {t('web.library.failed', { name: library.name })}
      <Link href={library.lastScan ? `/history/${library.lastScan.jobId}` : '/history'}
        >{t('web.library.failed.link')}</Link
      >
    </p>
  {/if}

  {#if page?.scan}<ScanProgress progress={page.scan.progress} />{/if}

  {#if notice}<p class="alert notice" role="status">{notice}</p>{/if}

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {:else if page === undefined}
    <p class="muted" role="status">{t('web.loading')}</p>
  {:else if page.scannedAt === null && page.counts.all === 0}
    <section class="card">
      <h3>{t('web.library.never.title')}</h3>
      <p class="muted">{t('web.library.never.body')}</p>
    </section>
  {:else}
    <div class="filters" role="group" aria-label={t('web.library.filter.label')}>
      {#each [undefined, ...filters] as option (option ?? 'all')}
        <button
          type="button"
          class="btn"
          aria-pressed={filter === option}
          onclick={() => {
            router.setQuery({ state: option });
          }}
        >
          {t(`web.library.filter.${option ?? 'all'}`)}
          <span class="count">{page.counts[option ?? 'all']}</span>
        </button>
      {/each}
    </div>
    <input
      class="input"
      type="search"
      placeholder={t('web.library.search')}
      aria-label={t('web.library.search')}
      bind:value={query}
      oninput={refilter}
    />

    {#if tree}
      <ShowsTree
        libraryId={library.id}
        writes={page.library.writes}
        {query}
        only={filter === 'missing-episodes' || filter === 'missing-show-files' ? filter : undefined}
        settleCount={page.counts.review + page.counts.unrecognized}
        onsettled={(message: string) => {
          notice = message;
          void load();
        }}
      />
    {:else if page.items.length === 0}
      <p class="card muted">{t('web.library.empty')}</p>
    {:else}
      {#if pickedItems.length > 0}
        <div class="bar" role="group">
          <span>{t('web.library.run.selected', { count: pickedItems.length })}</span>
          <button
            type="button"
            class="btn btn-primary"
            disabled={split.rename.length === 0}
            onclick={() => {
              running = 'rename';
            }}
          >
            {t('web.library.run.rename')}
          </button>
          <button
            type="button"
            class="btn"
            disabled={split.refresh.length === 0}
            onclick={() => {
              running = 'refresh';
            }}
          >
            {t('web.library.run.refresh')}
          </button>
        </div>
      {/if}
      <div class="layout">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>{t('web.library.col.title')}</th>
                <th>{t('web.library.col.year')}</th>
                <th>{t('web.library.col.video')}</th>
                {#if page.library.writes.nfo}<th>NFO</th>{/if}
                {#if page.library.writes.artwork}
                  <th>{t('web.library.col.poster')}</th>
                  <th>{t('web.library.col.fanart')}</th>
                {/if}
              </tr>
            </thead>
            <tbody>
              {#each page.items as item (item.id)}
                <tr class:current={open?.id === item.id}>
                  <td>
                    {#if canRun(item)}
                      <input
                        type="checkbox"
                        aria-label={t('web.library.run.select', {
                          name: item.title ?? item.path.split('/').pop() ?? '',
                        })}
                        checked={picked.includes(item.id)}
                        onchange={(event) => {
                          pick(item.id, event.currentTarget.checked);
                        }}
                      />
                    {/if}
                  </td>
                  <td>
                    <button
                      type="button"
                      class="link"
                      aria-current={open?.id === item.id ? 'true' : undefined}
                      onclick={() => {
                        chosen = item.id;
                        notice = undefined;
                      }}
                    >
                      {item.title ?? item.path.split('/').pop()}
                      {episodeLabel(item.season, item.episode, item.episodeEnd)}
                    </button>
                    {#if item.state !== 'ok'}<span class="chip {STATE_CHIP[item.state]}"
                        >{t(`web.library.state.${item.state}`)}</span
                      >{/if}
                  </td>
                  <td>{item.year ?? ''}</td>
                  <td>{item.resolution ?? ''}</td>
                  {#if page.library.writes.nfo}<td
                      >{item.nfo === null ? '' : item.nfo ? '✓' : '✗'}</td
                    >{/if}
                  {#if page.library.writes.artwork}
                    <td>{item.poster === null ? '' : item.poster ? '✓' : '✗'}</td>
                    <td>{item.fanart === null ? '' : item.fanart ? '✓' : '✗'}</td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
          {#if page.total > page.items.length}
            <button
              type="button"
              class="btn"
              onclick={() => {
                limit += PAGE_SIZE;
                void load();
              }}>{t('web.library.more', { shown: page.items.length, total: page.total })}</button
            >
          {/if}
        </div>

        <div>
          {#if open}
            {#key open.id}
              <ItemPanel
                libraryId={library.id}
                item={open}
                ondone={(message: string) => {
                  notice = message;
                  chosen = undefined;
                  void load();
                }}
              />
            {/key}
          {:else}
            <p class="muted">{t('web.library.pick')}</p>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>

{#if running && toRun.length > 0}
  <RunDialog
    libraryId={library.id}
    items={toRun}
    mode={running}
    onclose={() => {
      running = undefined;
    }}
    ondone={(message: string) => {
      notice = message;
      picked = [];
      running = undefined;
      void load();
    }}
  />
{/if}

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  h2 {
    font-size: 18px;
  }

  p {
    margin: 0;
  }

  .path {
    font-size: 11.5px;
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

  .count {
    margin-left: 6px;
    color: var(--muted);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .notice {
    color: var(--ok);
    background: var(--ok-bg);
    border-color: var(--ok);
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(280px, 1fr);
    gap: 16px;
    align-items: start;
  }

  .table-wrap {
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    text-align: left;
  }

  th {
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
  }

  tr.current {
    background: var(--surface-2);
  }

  .link {
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }

  .link:hover {
    text-decoration: underline;
  }

  @media (max-width: 960px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
