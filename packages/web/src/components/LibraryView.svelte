<script lang="ts">
  import { messageOf } from '../lib/errors.js';
  import { onDestroy, untrack } from 'svelte';
  import { refetchOn } from '../lib/events.svelte.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import type { Settled } from '../lib/arrivals.js';
  import { formatDate } from '../lib/history.js';
  import { libraryApi, type Library } from '../lib/libraries.js';
  import { baseName } from '../lib/paths.js';
  import { loadWhenVisible } from '../lib/infinite-scroll.js';
  import { router } from '../lib/router.svelte.js';
  import { libraryKey, runs, validations } from '../lib/validations.svelte.js';
  import { oneOf } from '../lib/routes.js';
  import {
    ITEM_FILTERS,
    PAGE_SIZE,
    SERIES_FILTERS,
    canRun,
    canNameVersion,
    versionsToName,
    versionsToRun,
    partition,
    lastScanFailed,
    libraryItems,
    scanPercent,
    type BulkAction,
    type ItemFilter,
    type ItemState,
    type ItemsPage,
    type ShowFilter,
  } from '../lib/library-items.js';
  import {
    canFile,
    collectionsApi,
    nfoCount,
    viewOf,
    type CollectionsPage,
    type ItemSort,
  } from '../lib/collections.js';
  import {
    activeCount,
    activePills,
    ariaSortOf,
    directionToAsk,
    nextSort,
    sortFromQuery,
    sortToQuery,
    visibleChips,
    type ListFilters,
    type Pill,
    type SortColumn,
  } from '../lib/list-filters.js';
  import ListFilterRow from './ListFilterRow.svelte';
  import ListToolbar from './ListToolbar.svelte';
  import SortButton from './SortButton.svelte';
  import CollectionDialog from './CollectionDialog.svelte';
  import CollectionsView from './CollectionsView.svelte';
  import ItemPanel from './ItemPanel.svelte';
  import RunDialog from './RunDialog.svelte';
  import Link from './Link.svelte';
  import Presence from './Presence.svelte';
  import ScanProgress from './ScanProgress.svelte';
  import VersionBadges from './VersionBadges.svelte';
  import ShowsTree from './ShowsTree.svelte';
  import { episodeLabel } from '../lib/library-items.js';
  import SelectionBar from './SelectionBar.svelte';
  import { Ticks } from '../lib/ticks.svelte.js';

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
  let running = $state<BulkAction | undefined>(undefined);
  let filing = $state(false);
  /** Bumped when a change reaches the open page without going through it (a bulk filing). */
  let panelVersion = $state(0);

  /** A row can be ticked to be renamed or refreshed, or (a library with collections) to be filed. */
  const selectable = (
    item: Parameters<typeof canRun>[0] &
      Parameters<typeof canFile>[0] &
      Parameters<typeof canNameVersion>[0],
  ): boolean =>
    canRun(item) || canNameVersion(item) || (page?.library.collections === true && canFile(item));

  const ticks = new Ticks({
    rows: () => page?.items.filter(selectable) ?? [],
    key: ({ id }) => id,
    total: () => page?.total,
    loaded: () => page?.items.length ?? 0,
    readAll: async () => {
      if (page !== undefined) {
        limit = page.total;
        await load();
      }
    },
  });
  const pickedItems = $derived(ticks.picked);
  const split = $derived(partition(pickedItems));
  const filable = $derived(pickedItems.filter(canFile));
  const toFile = $derived(filable.map(({ id }) => id));
  const toRun = $derived.by(() => {
    const mode = running;
    if (mode === undefined) {
      return [];
    }
    if (mode === 'version') {
      return pickedItems.flatMap((item) => versionsToName(item));
    }
    const wanted = new Set(split[mode]);
    return pickedItems
      .filter(({ id }) => wanted.has(id))
      .flatMap((item) => versionsToRun(item, mode));
  });

  // A series library always reads as a tree of shows, whatever the tab: the tab narrows the shows
  // (and its counts are in shows). A movie library is a flat list of files.
  const isSeries = $derived(library.type === 'series');
  const states: readonly ShowFilter[] = $derived(isSeries ? SERIES_FILTERS : ITEM_FILTERS);
  // The filters and the sort live in the URL (`?state=review&multi=1&collection=in&sort=year&dir=asc`):
  // a link keeps them, and so does a reload.
  const filter = $derived(oneOf(router.query.get('state'), states));
  const multi = $derived(router.query.get('multi') === '1');
  // Films | Collections (`?vue=collections&collection=<key>`): a movie library that writes NFO has
  // both. In the Collections view `collection` is the one selected, not a filter of the list.
  const hasCollections = $derived(!isSeries && page?.library.collections === true);
  const view = $derived(hasCollections ? viewOf(router.query.get('vue')) : 'films');
  const collectionFilter = $derived(
    isSeries || view === 'collections' ? undefined : (router.query.get('collection') ?? undefined),
  );
  const columns = $derived<readonly SortColumn[]>(
    isSeries ? ['title', 'year', 'missing'] : ['title', 'year'],
  );
  const order = $derived(
    sortFromQuery({ sort: router.query.get('sort'), dir: router.query.get('dir') }, columns),
  );

  const filters = $derived<ListFilters>({ state: filter, multi, collection: collectionFilter });
  const badge = $derived(activeCount(filters));
  const chips = $derived(page ? visibleChips(states, page.counts, filter) : []);
  const pills = $derived(activePills(filters));
  /** How many the list holds once narrowed; a series library's tree says it (it reads its own shows). */
  let shownShows = $state<number | undefined>(undefined);
  const filtered = $derived(badge > 0 || searched.trim() !== '');
  const result = $derived.by(() => {
    const count = isSeries ? shownShows : page?.total;
    if (!page || !filtered || count === undefined) {
      return '';
    }
    return t(isSeries ? 'web.library.result.shows' : 'web.library.result.movies', {
      count,
      total: page.counts.all,
    });
  });

  const sortBy = (column: SortColumn): void => {
    router.setQuery(sortToQuery(nextSort(order, column)));
  };

  /** Removes every filter and the search: the view a library opens on. */
  function reset(): void {
    const searching = query !== '' || searched !== '';
    clearTimeout(typing);
    query = '';
    searched = '';
    router.setQuery({ state: undefined, multi: undefined, collection: undefined });
    // A change of the URL reloads by itself (below); a search alone does not.
    if (searching && badge === 0) {
      refilter();
    }
  }

  function remove(pill: Pill): void {
    router.setQuery(pill.id === 'multi' ? { multi: undefined } : { collection: undefined });
  }

  const asked = (): string =>
    `${filter ?? ''}|${multi}|${collectionFilter ?? ''}|${order.sort}|${order.dir}`;
  let shown = untrack(asked);
  $effect(() => {
    const current = asked();
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

  /** The collections of the library: how many, for the selector, and their names, for the pill. */
  let collections = $state<CollectionsPage | undefined>(undefined);
  const collectionName = $derived(
    collectionFilter === undefined
      ? ''
      : (collections?.collections.find((one) => one.key === collectionFilter)?.name ??
          collectionFilter.slice(collectionFilter.indexOf(':') + 1)),
  );

  let latest = 0;
  async function load(): Promise<void> {
    const ticket = ++latest;
    try {
      // The tree reads its shows itself: here only the counts and the scan are wanted.
      const answer = await libraryItems.page(library.id, {
        state: isSeries ? undefined : (filter as ItemFilter | undefined),
        multi: isSeries ? undefined : multi,
        collection: isSeries ? undefined : collectionFilter,
        sort: isSeries ? undefined : (order.sort as ItemSort),
        dir: isSeries ? undefined : directionToAsk(order),
        q: searched,
        limit: isSeries ? 1 : limit,
      });
      if (ticket === latest) {
        page = answer;
        failure = undefined;
      }
      if (answer.library.collections && ticket === latest) {
        collections = await collectionsApi.list(library.id).catch(() => collections);
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
    ticks.clear();
    void load();
  }
</script>

<div class="stack">
  <div class="head">
    <div class="identity">
      <div class="titlebar">
        <h2>{library.name}</h2>
        {#if hasCollections}
          <div class="segments" role="radiogroup" aria-label={t('web.collections.view.label')}>
            <label class="segment" class:on={view === 'films'}>
              <input
                type="radio"
                name="library-view"
                checked={view === 'films'}
                onchange={() => {
                  router.setQuery({ vue: undefined, collection: undefined });
                }}
              />
              {t('web.collections.view.films')}
              <span class="count">{page?.counts.all ?? ''}</span>
            </label>
            <label class="segment" class:on={view === 'collections'}>
              <input
                type="radio"
                name="library-view"
                checked={view === 'collections'}
                onchange={() => {
                  router.setQuery({ vue: 'collections', collection: undefined });
                }}
              />
              {t('web.collections.view.collections')}
              <span class="count">{collections?.collections.length ?? ''}</span>
            </label>
          </div>
        {/if}
      </div>
      <p class="muted meta">
        <span class="mono path">{library.source}</span>
        {#if page?.scannedAt}
          <span aria-hidden="true">·</span>
          <span>{t('web.library.scanned', { date: formatDate(page.scannedAt, locale.value) })}</span
          >
        {:else if page}
          <span aria-hidden="true">·</span>
          <span>{t('web.library.never')}</span>
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
  {:else if view === 'collections'}
    <CollectionsView {library} />
  {:else}
    <ListToolbar
      {query}
      oninput={(value: string) => {
        query = value;
        search();
      }}
      {states}
      counts={page.counts}
      chosen={filter}
      {multi}
      {badge}
      onstate={(next: ShowFilter | undefined) => {
        router.setQuery({ state: next });
      }}
      onmulti={(next: boolean) => {
        router.setQuery({ multi: next ? '1' : undefined });
      }}
      onreset={reset}
    />
    <ListFilterRow
      {chips}
      {filters}
      {pills}
      {collectionName}
      {result}
      onstate={(next: ShowFilter | undefined) => {
        router.setQuery({ state: next });
      }}
      onremove={remove}
      onreset={reset}
    />

    {#if isSeries}
      <ShowsTree
        libraryId={library.id}
        source={library.source}
        writes={page.library.writes}
        query={searched}
        {filter}
        {multi}
        sort={order.sort}
        dir={directionToAsk(order)}
        {busy}
        onshown={(count: number | undefined) => {
          shownShows = count;
        }}
        onsettled={(message: string) => {
          notice = message;
          void load();
        }}
      />
    {:else if page.items.length === 0}
      <p class="card muted empty">
        {filtered ? t('web.library.empty.filtered') : t('web.library.empty')}
        {#if filtered}
          <button type="button" class="btn" onclick={reset}>{t('web.library.filters.clear')}</button
          >
        {/if}
      </p>
    {:else}
      {#if page.items.some(selectable)}
        <SelectionBar
          checked={ticks.everyPicked}
          indeterminate={ticks.somePicked}
          ontoggle={(all: boolean) => {
            ticks.all(all);
          }}
          everything={ticks.canPickEverything
            ? {
                label: t('web.library.run.everything', { count: page.total }),
                onclick: () => void ticks.pickEverything(),
              }
            : undefined}
          count={pickedItems.length}
          selected={t('web.library.run.selected', { count: pickedItems.length })}
          disabled={{
            rename: split.rename.length === 0 || busy,
            refresh: split.refresh.length === 0 || busy,
            version: !pickedItems.some((item) => versionsToName(item).length > 0) || busy,
          }}
          onrun={(action: BulkAction) => {
            running = action;
          }}
        >
          {#snippet extra()}
            {#if page?.library.collections}
              <button
                type="button"
                class="btn"
                aria-haspopup="dialog"
                disabled={toFile.length === 0}
                onclick={() => {
                  filing = true;
                }}
              >
                {t('web.collection.bulk')}
              </button>
            {/if}
          {/snippet}
        </SelectionBar>
        {#if filing && toFile.length > 0}
          <CollectionDialog
            libraryId={library.id}
            items={toFile}
            films={filable.length}
            nfo={nfoCount(filable)}
            onclose={() => {
              filing = false;
            }}
            ondone={(message: string) => {
              notice = message;
              ticks.clear();
              filing = false;
              // The open page may be one of the movies filed: it reads its collection again.
              panelVersion += 1;
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
                <th aria-sort={ariaSortOf(order, 'title')}>
                  <SortButton
                    column="title"
                    current={order}
                    label={t('web.library.col.title')}
                    onsort={sortBy}
                  />
                </th>
                <th aria-sort={ariaSortOf(order, 'year')}>
                  <SortButton
                    column="year"
                    current={order}
                    label={t('web.library.col.year')}
                    onsort={sortBy}
                  />
                </th>
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
              {#each page.items as item (item.id)}
                <tr class:current={open?.id === item.id}>
                  <td class="narrow">
                    {#if selectable(item)}
                      <input
                        type="checkbox"
                        aria-label={t('web.library.run.select', {
                          name: item.title ?? baseName(item.path),
                        })}
                        checked={ticks.has(item.id)}
                        onchange={(event) => {
                          ticks.toggle(item.id, event.currentTarget.checked);
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
            {#key page.items.length}
              <button
                type="button"
                class="btn"
                use:loadWhenVisible
                onclick={() => {
                  limit += PAGE_SIZE;
                  void load();
                }}>{t('web.library.more', { shown: page.items.length, total: page.total })}</button
              >
            {/key}
          {/if}
        </div>

        <div class="side">
          {#if open}
            {#key `${open.id}:${String(panelVersion)}`}
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
      ticks.clear();
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
    align-items: center;
    justify-content: space-between;
    gap: 12px 24px;
  }

  .identity {
    display: flex;
    flex: 1 1 420px;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  /* One line under the name: the path, then the date, wrapping rather than cutting a long path. */
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    font-size: 13px;
  }

  h2 {
    font-size: 18px;
  }

  .titlebar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
  }

  .segment .count {
    margin-left: 8px;
    font-weight: 600;
  }

  p {
    margin: 0;
  }

  .path {
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .empty {
    display: flex;
    flex-wrap: wrap;
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
    top: calc(var(--header-h, 0px) + 16px);
    max-height: calc(100vh - var(--header-h, 0px) - 32px);
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
