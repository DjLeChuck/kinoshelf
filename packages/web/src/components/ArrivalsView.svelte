<script lang="ts">
  import { untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { resource } from '../lib/resource.svelte.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { t } from '../lib/i18n.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { validations } from '../lib/validations.svelte.js';
  import { oneOf } from '../lib/routes.js';
  import {
    QUEUE_CHIP,
    STATUS_LABEL,
    groupReleases,
    readArrivals,
    releaseKey,
    startPlanned,
    statusOf,
    truncateMiddle,
    type Arrival,
    type ArrivalPage,
    type ArrivalState,
  } from '../lib/arrivals.js';
  import { Ticks } from '../lib/ticks.svelte.js';
  import ActionDialog from './ActionDialog.svelte';
  import ArrivalsBar from './ArrivalsBar.svelte';
  import { loadWhenVisible } from '../lib/infinite-scroll.js';
  import { MAX_SELECTION } from '../lib/library-items.js';
  import type { WatchScan, WatchStatus } from '../lib/watch.js';
  import ArrivalDetail from './ArrivalDetail.svelte';
  import Tip from './Tip.svelte';

  type Filter = 'all' | ArrivalState;
  const FILTERS: readonly Filter[] = ['all', 'ready', 'review', 'unrecognized', 'present'];

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
  const mates = $derived(
    open
      ? (page?.items.filter(
          (item) => releaseKey(item) === releaseKey(open) && item.cluster === open.cluster,
        ) ?? [])
      : [],
  );
  const siblings = $derived(Math.max(mates.length, 1));
  /** Everything matched with confidence that only waits for a go. */
  const ready = $derived(page?.items.filter(({ state }) => state === 'ready') ?? []);
  /** The list is whole: the ready files are all in it, and can be counted. */
  const whole = $derived(page !== undefined && page.total === page.items.length);
  // A list not read to the end may still hold ready files further down: the button reads them when
  // pressed. Under another filter ("to review") it would be offered for files that tab never shows.
  const canTransferAll = $derived(
    whole ? ready.length > 0 : page !== undefined && (filter === 'all' || filter === 'ready'),
  );
  let starting = $state(false);

  async function transferAll(): Promise<void> {
    starting = true;
    try {
      // Not the files on screen but every one that is ready, as the button promises.
      const everything = whole
        ? ready
        : (
            await readArrivals(MAX_SELECTION, (limit, offset) =>
              api.get<ArrivalPage>(`/api/arrivals?limit=${limit}&offset=${offset}&state=ready`),
            )
          ).items.filter(({ state }) => state === 'ready');
      // A file being validated is held by that validation: asking for it too would be refused.
      const count = await startPlanned(
        everything.filter(({ id }) => !validations.running(id)),
        api.post,
      );
      notice = t('web.arrivals.transfer-all.done', { count });
      loaded.failure = undefined;
    } catch (error) {
      loaded.failure = error;
    } finally {
      starting = false;
    }
    void load();
  }

  /** A line of the list: a release (its main series) or another series found in its folder. */
  interface Row {
    readonly lead: Arrival;
    readonly files: readonly Arrival[];
  }
  const rows = $derived(
    groups.flatMap((group): Row[] => [
      ...(group.files[0] ? [{ lead: group.files[0], files: group.files }] : []),
      ...group.others.flatMap((other) =>
        other.files[0] ? [{ lead: other.files[0], files: other.files }] : [],
      ),
    ]),
  );
  // The boxes tick what the page holds; the server expands a release into all its files.
  const ticks = new Ticks<Row, string>({
    rows: () => rows,
    key: ({ lead }) => lead.id,
    total: () => undefined,
    loaded: () => rows.length,
    readAll: () => Promise.resolve(),
  });
  const picked = $derived(ticks.picked);
  const allReady = $derived(
    picked.length > 0 && picked.every(({ lead }) => lead.state === 'ready'),
  );
  let acting = $state(false);
  let confirmingPresent = $state(false);
  const presentCount = $derived(page?.counts.present ?? 0);

  /** Says what an ignore did: how many files, and how many a transfer in progress kept out. */
  const ignoredNotice = ({ ignored, held }: { ignored: number; held: number }): string =>
    held > 0
      ? t('web.arrivals.ignored.held', { ignored, held })
      : t('web.arrivals.ignored', { ignored });

  async function ignoreMany(body: { ids: string[] } | { state: ArrivalState }): Promise<void> {
    acting = true;
    try {
      const result = await api.post<{ ignored: number; held: number }>('/api/entries/ignore', body);
      notice = ignoredNotice(result);
      ticks.clear();
      loaded.failure = undefined;
    } catch (error) {
      loaded.failure = error;
    } finally {
      acting = false;
    }
    void load();
  }

  async function transferPicked(): Promise<void> {
    acting = true;
    try {
      const files = picked
        .flatMap(({ files: all }) => all.filter(({ state }) => state === 'ready'))
        .filter(({ id }) => !validations.running(id));
      notice = t('web.arrivals.transfer-all.done', { count: await startPlanned(files, api.post) });
      ticks.clear();
      loaded.failure = undefined;
    } catch (error) {
      loaded.failure = error;
    } finally {
      acting = false;
    }
    void load();
  }

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

{#snippet pick(lead: Arrival, name: string)}
  <label class="pick">
    <input
      type="checkbox"
      aria-label={t('web.arrivals.select-row', { name })}
      checked={ticks.has(lead.id)}
      onchange={(event) => {
        ticks.toggle(lead.id, event.currentTarget.checked);
      }}
    />
  </label>
{/snippet}

<!-- What the library holds of a file, said on its line: where, and which file. -->
{#snippet held(lead: Arrival)}
  {#if lead.duplicate && lead.state === 'present'}
    <span class="meta">
      <span class="muted"
        >{t('web.arrivals.in-library', { library: lead.duplicate.libraryName })}</span
      >
      <span class="mono">{truncateMiddle(lead.duplicate.file)}</span>
    </span>
  {/if}
{/snippet}

<div class="stack">
  <div class="intro">
    <p class="muted">{t('web.arrivals.intro')}</p>
    <Tip text={watch?.scannable ? undefined : t('web.arrivals.check.none')}>
      {#snippet children(describedby)}
        <button
          type="button"
          class="btn"
          disabled={!watch?.scannable || checking}
          aria-describedby={describedby}
          onclick={() => void checkNow()}>{t('web.arrivals.check')}</button
        >
      {/snippet}
    </Tip>
    <Tip text={t('web.arrivals.recheck.hint')}>
      {#snippet children(describedby)}
        <button
          type="button"
          class="btn"
          disabled={!watch?.scannable || checking}
          aria-describedby={describedby}
          onclick={() => void checkNow(true)}>{t('web.arrivals.recheck')}</button
        >
      {/snippet}
    </Tip>
  </div>

  <div class="filters" role="group" aria-label={t('web.arrivals.filter.label')}>
    {#each FILTERS as option (option)}
      <button
        type="button"
        class="btn"
        aria-pressed={filter === option}
        onclick={() => {
          router.setQuery({ state: option === 'all' ? undefined : option });
        }}
        >{t(`web.arrivals.filter.${option}`)}{#if option !== 'all' && page}
          <span class="count">{page.counts[option]}</span>{/if}</button
      >
    {/each}
  </div>

  {#if canTransferAll}
    <div>
      <button
        type="button"
        class="btn btn-primary"
        disabled={starting}
        onclick={() => void transferAll()}
        >{starting
          ? t('web.arrivals.transfer-all.running')
          : whole
            ? t('web.arrivals.transfer-all', { count: ready.length })
            : t('web.arrivals.transfer-all.any')}</button
      >
    </div>
  {/if}

  {#if filter === 'present' && presentCount > 0}
    <div>
      <button
        type="button"
        class="btn btn-primary"
        disabled={acting}
        onclick={() => {
          confirmingPresent = true;
        }}>{t('web.arrivals.ignore-present', { count: presentCount })}</button
      >
    </div>
  {/if}

  {#if confirmingPresent}
    <ActionDialog
      title={t('web.arrivals.ignore-present.title')}
      does={t('web.arrivals.ignore-present.does', { count: presentCount })}
      keeps={t('web.arrivals.ignore-present.keeps')}
      confirm={t('web.arrivals.ignore-present.confirm')}
      onclose={() => {
        confirmingPresent = false;
      }}
      onconfirm={() => void ignoreMany({ state: 'present' })}
    />
  {/if}

  {#if notice}<p class="alert notice" role="status">{notice}</p>{/if}

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {:else if page === undefined}
    <p class="muted" role="status">{t('web.loading')}</p>
  {:else if page.items.length === 0}
    <p class="card muted">{t('web.arrivals.empty')}</p>
  {:else}
    <ArrivalsBar
      checked={ticks.everyPicked}
      indeterminate={ticks.somePicked}
      ontoggle={(all: boolean) => {
        ticks.all(all);
      }}
      count={picked.length}
      selected={t('web.arrivals.selected', { count: picked.length })}
      canTransfer={allReady}
      busy={acting}
      onignore={() => void ignoreMany({ ids: picked.map(({ lead }) => lead.id) })}
      ontransfer={() => void transferPicked()}
    />
    <div class="layout">
      <ul class="list" aria-label={t('web.arrivals.list.label')}>
        {#each groups as group (group.key)}
          {@const lead = group.files[0]}
          <li>
            {#if lead}
              {@const status = statusOf(lead)}
              <div class="row">
                {@render pick(lead, group.name)}
                <button
                  type="button"
                  class:current={open?.id !== undefined &&
                    group.files.some((f) => f.id === open.id)}
                  aria-current={group.files.some((f) => f.id === open?.id) ? 'true' : undefined}
                  onclick={() => {
                    chosen = lead.id;
                    notice = undefined;
                  }}
                >
                  <span class="mono release">{group.name}</span>
                  <span class="meta">
                    {#if validations.anyRunning(group.files.map((f) => f.id))}<span
                        class="chip chip-neutral">{t('web.queue.validating')}</span
                      >{:else if validations.firstFailure(group.files.map((f) => f.id))}<span
                        class="chip chip-danger"
                        role="alert"
                        >{messageOf(
                          t,
                          validations.firstFailure(group.files.map((f) => f.id))?.error,
                        )}</span
                      >{:else}<span class="chip {QUEUE_CHIP[status]}"
                        >{t(STATUS_LABEL[status])}</span
                      >{/if}
                    {#if group.files.length > 1}<span class="muted"
                        >{t('web.arrivals.files', { count: group.files.length })}</span
                      >{/if}
                    {#if sourceName(lead)}<span class="muted"
                        >{t('web.arrivals.from', { source: sourceName(lead) ?? '' })}</span
                      >{/if}
                  </span>
                  {@render held(lead)}
                </button>
              </div>
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
                      <div class="row">
                        {@render pick(arrival, arrival.file)}
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
                          {@render held(arrival)}
                        </button>
                      </div>
                    </li>
                  {/if}
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
        {#if page.total > page.items.length}
          <li>
            {#key page.items.length}
              <button
                type="button"
                class="btn"
                use:loadWhenVisible
                onclick={() => {
                  releases += PAGE;
                  void load();
                }}>{t('web.library.more', { shown: page.items.length, total: page.total })}</button
              >
            {/key}
          </li>
        {/if}
      </ul>

      <div>
        {#if open}
          {#key open.id}
            <ArrivalDetail
              entry={open}
              {siblings}
              {mates}
              ondone={(message: string) => {
                // The list reloads whichever row is open; nothing here closes the panel.
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

  .count {
    margin-left: 6px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 11.5px;
  }

  .row {
    display: flex;
    align-items: flex-start;
    gap: 4px;
  }

  /* A 44 px target around the 20 px box, as the lists of a library have. */
  .pick {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 44px;
    min-height: 44px;
    cursor: pointer;
  }

  .row > button {
    flex: 1;
    min-width: 0;
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
