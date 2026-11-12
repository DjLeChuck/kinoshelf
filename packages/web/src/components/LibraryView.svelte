<script lang="ts">
  import { messageOf } from '../lib/errors.js';
  import { onDestroy, untrack } from 'svelte';
  import { refetchOn } from '../lib/events.svelte.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import type { Settled } from '../lib/arrivals.js';
  import { formatDate } from '../lib/history.js';
  import { libraryApi, type Library } from '../lib/libraries.js';
  import { baseName } from '../lib/paths.js';
  import { router } from '../lib/router.svelte.js';
  import { libraryKey, runs, validations } from '../lib/validations.svelte.js';
  import { oneOf } from '../lib/routes.js';
  import {
    ITEM_FILTERS,
    PAGE_SIZE,
    SERIES_FILTERS,
    canRun,
    versionsToRun,
    partition,
    lastScanFailed,
    libraryItems,
    scanPercent,
    type ItemFilter,
    type ItemState,
    type ItemsPage,
  } from '../lib/library-items.js';
  import {
    ITEM_SORTS,
    canFile,
    nameOfKey,
    pillOf,
    startsGroup,
    type CollectionFilter,
    type ItemSort,
  } from '../lib/collections.js';
  import CollectionBar from './CollectionBar.svelte';
  import CollectionBulk from './CollectionBulk.svelte';
  import ItemPanel from './ItemPanel.svelte';
  import RunDialog from './RunDialog.svelte';
  import Link from './Link.svelte';
  import Presence from './Presence.svelte';
  import ScanProgress from './ScanProgress.svelte';
  import VersionBadges from './VersionBadges.svelte';
  import ShowsTree from './ShowsTree.svelte';
  import { episodeLabel } from '../lib/library-items.js';

  let { library }: { library: Library } = $props();

  const SEARCH_PAUSE_MS = 250;

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
  /** What the box held when typing paused: a request per keystroke would be a request per letter. */
  let searched = $state('');
  let typing: ReturnType<typeof setTimeout> | undefined;
  function search(): void {
    clearTimeout(typing);
    typing = setTimeout(() => {
      searched = query;
      refilter();
    }, SEARCH_PAUSE_MS);
  }
  onDestroy(() => {
    clearTimeout(typing);
  });
  let limit = $state(PAGE_SIZE);
  let chosen = $state<string | undefined>(undefined);
  let notice = $state<string | undefined>(undefined);
  let starting = $state(false);
  let picked = $state<readonly string[]>([]);
  let running = $state<'rename' | 'refresh' | undefined>(undefined);
  let filing = $state(false);

  /** A row can be ticked to be renamed or refreshed, or (a library with collections) to be filed. */
  const selectable = (
    item: Parameters<typeof canRun>[0] & Parameters<typeof canFile>[0],
  ): boolean => canRun(item) || (page?.library.collections === true && canFile(item));

  const pickedIds = $derived(new Set(picked));
  const pickedItems = $derived((page?.items ?? []).filter(({ id }) => pickedIds.has(id)));
  const split = $derived(partition(pickedItems));
  const toFile = $derived(pickedItems.filter(canFile).map(({ id }) => id));
  const toRun = $derived.by(() => {
    const mode = running;
    if (mode === undefined) {
      return [];
    }
    const wanted = new Set(split[mode]);
    return pickedItems
      .filter(({ id }) => wanted.has(id))
      .flatMap((item) => versionsToRun(item, mode));
  });

  function pick(id: string, on: boolean): void {
    picked = on ? [...picked, id] : picked.filter((other) => other !== id);
  }

  // A series library always reads as a tree of shows, whatever the tab: the tab narrows the shows
  // (and its counts are in shows). A movie library is a flat list of files.
  const isSeries = $derived(library.type === 'series');
  const filters = $derived(isSeries ? SERIES_FILTERS : ITEM_FILTERS);
  // The filter lives in the URL (`?state=review`): a link keeps it, and so does a reload.
  const filter = $derived(oneOf(router.query.get('state'), filters));
  // The collection filter and the sort live in the URL too (`?collection=in&sort=collection`).
  const collectionFilter = $derived(router.query.get('collection') ?? undefined);
  const sort = $derived<ItemSort>(oneOf(router.query.get('sort'), ITEM_SORTS) ?? 'title');
  // The column and the filters appear once there is a collection to show (or one is being looked at):
  // a library with none would only carry empty controls. Filing a movie stays offered.
  const showsCollections = $derived(
    page?.library.collections === true &&
      (page.collectionCounts.in > 0 || collectionFilter !== undefined || sort !== 'title'),
  );

  let shown = untrack(() => `${filter ?? ''}|${collectionFilter ?? ''}|${sort}`);
  $effect(() => {
    const current = `${filter ?? ''}|${collectionFilter ?? ''}|${sort}`;
    if (current !== shown) {
      shown = current;
      untrack(refilter);
    }
  });

  const open = $derived(page?.items.find(({ id }) => id === chosen));
  const busy = $derived(page?.transfer != null || runs.running(libraryKey(library.id)));
  /** Read when a validation ends, not when its panel was drawn: the open row may have changed. */
  const openEntryId = (): string | null | undefined =>
    page?.items.find(({ id }) => id === chosen)?.entryId;
  const scanning = $derived(page?.scan != null || library.scanning);
  const percent = $derived(scanPercent(page?.scan?.progress ?? null));

  let latest = 0;
  async function load(): Promise<void> {
    const ticket = ++latest;
    try {
      // The tree reads its shows itself: here only the counts and the scan are wanted.
      const answer = await libraryItems.page(library.id, {
        state: isSeries ? undefined : (filter as ItemFilter | undefined),
        collection: isSeries ? undefined : collectionFilter,
        sort: isSeries ? undefined : sort,
        q: searched,
        limit: isSeries ? 1 : limit,
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
        page = {
          ...page,
          scan: {
            ...current,
            status: job.status,
            progress: job.progress,
            transfer: job.transfer,
          },
        };
      }
    } catch {
      // The next full load says what went wrong.
    } finally {
      following = false;
    }
  }

  // A transfer has no job of its own to read: the page is read again, at the pace of the events.
  refetchOn(['progress'], () => void (page?.scan ? follow() : load()));

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

  {#if page?.scan}<ScanProgress progress={page.scan.progress} transfer={page.scan.transfer} />{/if}

  {#if page?.transfer && !page.scan}
    <div class="card transfer" role="status" aria-live="polite">
      <progress
        max={Math.max(page.transfer.total, 1)}
        value={page.transfer.done}
        aria-label={t('web.library.transfer.label')}
      ></progress>
      <p class="muted">
        {t('web.library.transfer.running', {
          done: page.transfer.done,
          total: page.transfer.total,
        })}
        <Link href="/history">{t('web.library.transfer.link')}</Link>
      </p>
    </div>
  {/if}

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
      oninput={search}
    />

    {#if showsCollections}
      <CollectionBar
        counts={page.collectionCounts}
        filter={collectionFilter}
        {sort}
        activeName={collectionFilter ? nameOfKey(collectionFilter, page.items) : ''}
        onfilter={(next: CollectionFilter | undefined) => {
          router.setQuery({ collection: next });
        }}
        onsort={(next: ItemSort) => {
          router.setQuery({ sort: next === 'title' ? undefined : next });
        }}
      />
    {/if}

    {#if isSeries}
      <ShowsTree
        libraryId={library.id}
        source={library.source}
        writes={page.library.writes}
        query={searched}
        {filter}
        {busy}
        onsettled={(message: string) => {
          notice = message;
          void load();
        }}
      />
    {:else if page.items.length === 0}
      <p class="card muted">{t('web.library.empty')}</p>
    {:else}
      {#if page.items.some(selectable)}
        <div class="bar" role="group">
          <label class="check">
            <input
              type="checkbox"
              checked={pickedItems.length === page.items.filter(selectable).length}
              indeterminate={pickedItems.length > 0 &&
                pickedItems.length < page.items.filter(selectable).length}
              onchange={(event) => {
                picked = event.currentTarget.checked
                  ? (page?.items.filter(selectable).map(({ id }) => id) ?? [])
                  : [];
              }}
            />
            {t('web.library.run.all')}
          </label>
          {#if pickedItems.length > 0}
            <span>{t('web.library.run.selected', { count: pickedItems.length })}</span>
            <button
              type="button"
              class="btn btn-primary"
              disabled={split.rename.length === 0 || busy}
              onclick={() => {
                running = 'rename';
              }}
            >
              {t('web.library.run.rename')}
            </button>
            <button
              type="button"
              class="btn"
              disabled={split.refresh.length === 0 || busy}
              onclick={() => {
                running = 'refresh';
              }}
            >
              {t('web.library.run.refresh')}
            </button>
            {#if page.library.collections}
              <button
                type="button"
                class="btn"
                aria-expanded={filing}
                disabled={toFile.length === 0}
                onclick={() => {
                  filing = !filing;
                }}
              >
                {t('web.collection.bulk')}
              </button>
            {/if}
          {/if}
        </div>
        {#if filing && toFile.length > 0}
          <CollectionBulk
            libraryId={library.id}
            items={toFile}
            onclose={() => {
              filing = false;
            }}
            ondone={(message: string) => {
              notice = message;
              picked = [];
              filing = false;
              void load();
            }}
          />
        {/if}
      {/if}
      <div class="layout">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>{t('web.library.col.title')}</th>
                <th>{t('web.library.col.year')}</th>
                {#if showsCollections}<th>{t('web.collection.col')}</th>{/if}
                <th>{t('web.library.col.versions')}</th>
                {#if page.library.writes.nfo}<th>NFO</th>{/if}
                {#if page.library.writes.artwork}
                  <th>{t('web.library.col.poster')}</th>
                  <th>{t('web.library.col.fanart')}</th>
                {/if}
                {#if page.library.writes.logo}<th>{t('web.library.col.logo')}</th>{/if}
              </tr>
            </thead>
            <tbody>
              {#each page.items as item, index (item.id)}
                <tr
                  class:current={open?.id === item.id}
                  class:group-start={startsGroup(page.items, index, sort)}
                >
                  <td class="narrow">
                    {#if selectable(item)}
                      <input
                        type="checkbox"
                        aria-label={t('web.library.run.select', {
                          name: item.title ?? baseName(item.path),
                        })}
                        checked={pickedIds.has(item.id)}
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
                      {item.title ?? baseName(item.path)}
                      {episodeLabel(item.season, item.episode, item.episodeEnd)}
                    </button>
                    {#if runs.running(item.id) || item.versions.some( (version) => runs.running(version.id) )}<span
                        class="chip chip-neutral">{t('web.library.run.running')}</span
                      >{:else if validations.running(item.entryId)}<span class="chip chip-neutral"
                        >{t('web.queue.validating')}</span
                      >{:else if validations.failure(item.entryId)}<span
                        class="chip chip-danger"
                        role="alert">{messageOf(t, validations.failure(item.entryId)?.error)}</span
                      >{:else if item.state !== 'ok'}<span class="chip {STATE_CHIP[item.state]}"
                        >{t(`web.library.state.${item.state}`)}</span
                      >{/if}
                  </td>
                  <td>{item.year ?? ''}</td>
                  {#if showsCollections}
                    <td class="collection">
                      {#if item.collection}
                        {@const pill = pillOf(item.collection)}
                        {@const named = item.collection}
                        <button
                          type="button"
                          class="link collection-name"
                          aria-label={t('web.collection.filter.by', { name: named.name })}
                          onclick={() => {
                            router.setQuery({ collection: named.key });
                          }}>{named.name}</button
                        >
                        <span class="chip chip-{pill.kind}"
                          >{pill.text ?? t('web.collection.custom')}</span
                        >
                      {:else}
                        <span class="muted" aria-hidden="true">—</span><span class="sr-only"
                          >{t('web.collection.none')}</span
                        >
                      {/if}
                    </td>
                  {/if}
                  <td><VersionBadges versions={item.versions} /></td>
                  {#if page.library.writes.nfo}<td><Presence value={item.nfo} /></td>{/if}
                  {#if page.library.writes.artwork}
                    <td
                      ><Presence
                        value={item.poster}
                        unavailable={item.unavailable.includes('poster')}
                      /></td
                    >
                    <td
                      ><Presence
                        value={item.fanart}
                        unavailable={item.unavailable.includes('fanart')}
                      /></td
                    >
                  {/if}
                  {#if page.library.writes.logo}<td
                      ><Presence
                        value={item.logo}
                        unavailable={item.unavailable.includes('logo')}
                      /></td
                    >{/if}
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

        <div class="side">
          {#if open}
            {#key open.id}
              <ItemPanel
                libraryId={library.id}
                source={library.source}
                item={open}
                {busy}
                onnotice={(message: string) => {
                  notice = message;
                  void load();
                }}
                ondone={(message: string, settled?: Settled) => {
                  notice = message;
                  // Another row may be open by now: close the panel only if it is the one validated.
                  if (settled === undefined || openEntryId() === settled.id) {
                    chosen = undefined;
                  }
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
  .transfer progress {
    width: 100%;
    accent-color: var(--accent);
  }

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

  /* The count of what is ticked, set apart from the "select all" box before it. */
  .bar > span {
    margin-left: 4px;
    padding-left: 12px;
    border-left: 1px solid var(--border-strong);
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

  .layout {
    display: grid;
    /* The list takes what the panel does not need: extra width goes to the columns. */
    grid-template-columns: minmax(0, 1fr) minmax(340px, 36%);
    gap: 16px;
    align-items: start;
  }

  /* Floats beside the list while it scrolls; a tall panel scrolls on its own rather than past the screen. */
  .side {
    position: sticky;
    top: 16px;
    max-height: calc(100vh - 32px);
    overflow-y: auto;
  }

  .table-wrap {
    display: flex;
    flex-direction: column;
    gap: 12px;
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

  /* The header stays in view while the page scrolls. The wrapper must not scroll on its own (an
     overflow makes it the sticky's reference), hence it only does on a narrow screen, below. A
     shadow draws the line: a border does not follow a sticky cell in a collapsed table. */
  thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--bg);
    box-shadow: 0 1px 0 var(--border);
  }

  .narrow {
    width: 1%;
    padding-right: 0;
  }

  tr.current {
    background: var(--surface-2);
  }

  /* Sorted by collection, a heavier line sets each saga apart from the one above. */
  tr.group-start > td {
    border-top: 2px solid var(--border-strong);
  }

  .collection {
    min-width: 0;
  }

  .collection > * {
    vertical-align: middle;
  }

  .collection-name {
    max-width: 18ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-decoration: underline;
    text-decoration-color: var(--border-strong);
    text-underline-offset: 3px;
  }

  /* An inset shadow, not a border: a border on a row of a collapsed table is not drawn everywhere. */
  tr.current > :first-child {
    box-shadow: inset 3px 0 0 var(--accent);
  }

  @media (max-width: 960px) {
    .table-wrap {
      overflow-x: auto;
    }

    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
