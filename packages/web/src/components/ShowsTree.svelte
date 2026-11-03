<script lang="ts">
  import { untrack } from 'svelte';
  import { messageOf } from '../lib/errors.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import { formatDay } from '../lib/history.js';
  import { router } from '../lib/router.svelte.js';
  import { listOf, listParam } from '../lib/routes.js';
  import {
    PAGE_SIZE,
    episodeLabel,
    libraryItems,
    type EpisodeState,
    type LibraryItem,
    type Show,
    type ShowDetail,
  } from '../lib/library-items.js';
  import Chevron from './Chevron.svelte';
  import ItemPanel from './ItemPanel.svelte';
  import ShowPanel from './ShowPanel.svelte';

  let {
    libraryId,
    writes,
    query,
    only,
    settleCount,
    onsettled,
  }: {
    libraryId: string;
    writes: { nfo: boolean; artwork: boolean };
    query: string;
    /** Only the shows that lack episodes, or files of their own (and nothing waiting to be validated). */
    only: 'missing-episodes' | 'missing-show-files' | undefined;
    /** Files to validate or identify, from the library's counts: they have no show. */
    settleCount: number;
    /** A file was settled: what to tell the user, and the library to read again. */
    onsettled: (message: string) => void;
  } = $props();

  const EPISODE_CHIP: Record<Exclude<EpisodeState, 'present'>, string> = {
    missing: 'chip-warn',
    unaired: 'chip-neutral',
    extra: 'chip-danger',
  };

  type Selection =
    | { readonly kind: 'show'; readonly tmdbId: number }
    | { readonly kind: 'item'; readonly item: LibraryItem };

  let shows = $state<{ total: number; items: readonly Show[] } | undefined>(undefined);
  let settling = $state<readonly LibraryItem[]>([]);
  let details = $state<Readonly<Record<number, ShowDetail>>>({});
  /** A show that could not be opened says so in its own row: the rest of the tree stays. */
  let showFailures = $state<Readonly<Record<number, unknown>>>({});
  /** How many files wait for a person, the server's count (the list shows the first ones). */
  let settleTotal = $state(0);
  // What is open lives in the URL (`?open=<tmdb ids>&seasons=<tmdb id>:<season>,…`): a reload or a
  // shared link opens the same shows.
  const opened = $derived(
    listOf(router.query.get('open'))
      .map(Number)
      .filter((id) => Number.isInteger(id)),
  );
  const seasonsOpen = $derived(listOf(router.query.get('seasons')));
  let settleOpen = $state(false);
  let selection = $state<Selection | undefined>(undefined);
  let failure = $state<unknown>(undefined);
  let limit = $state(PAGE_SIZE);

  const chosenShow = $derived.by(() => {
    const chosen = selection;
    return chosen?.kind === 'show'
      ? shows?.items.find((show) => show.tmdbId === chosen.tmdbId)
      : undefined;
  });

  let latest = 0;
  async function load(wanted = { query, only, settleCount }): Promise<void> {
    const ticket = ++latest;
    try {
      const answer = await libraryItems.shows(libraryId, {
        q: wanted.query,
        missing: wanted.only === 'missing-episodes',
        incomplete: wanted.only === 'missing-show-files',
        limit,
      });
      // The files that wait for a person are one node at the top, never inside a show.
      const pages =
        wanted.only !== undefined || wanted.settleCount === 0
          ? []
          : await Promise.all(
              (['review', 'unrecognized'] as const).map((state) =>
                libraryItems.page(libraryId, { state, q: wanted.query, limit: 100 }),
              ),
            );
      // A show that was open is read again, so the tree follows what a transfer changed.
      const fresh = await Promise.all(
        opened.map(
          async (id) => [id, await libraryItems.show(libraryId, id).catch(() => null)] as const,
        ),
      );
      if (ticket === latest) {
        shows = answer;
        settling = pages.flatMap((page) => page.items);
        settleTotal = pages.reduce((sum, page) => sum + page.total, 0);
        // Only what is open is kept: a closed show is read again when it opens.
        details = Object.fromEntries(
          Object.entries({
            ...details,
            ...Object.fromEntries(
              fresh.filter((entry): entry is [number, ShowDetail] => entry[1] !== null),
            ),
          }).filter(([id]) => opened.includes(Number(id))),
        );
        failure = undefined;
      }
    } catch (error) {
      if (ticket === latest) {
        failure = error;
      }
    }
  }

  // The parent's search box and filter come through the props: read again when they change.
  // Not on `settleCount`: it moves each time the parent reloads, and the tree already follows the
  // same events by itself. Not on the first run either: `refetchOn` below reads it once.
  let mounted = false;
  $effect(() => {
    const [wantedQuery, wantedOnly] = [query, only];
    untrack(() => {
      if (!mounted) {
        mounted = true;
        return;
      }
      limit = PAGE_SIZE;
      void load({ query: wantedQuery, only: wantedOnly, settleCount });
    });
  });

  refetchOn(['jobs', 'arrivals', 'history', 'settings', 'ready'], () => void load());

  async function toggle(show: Show): Promise<void> {
    selection = { kind: 'show', tmdbId: show.tmdbId };
    if (opened.includes(show.tmdbId)) {
      router.setQuery({ open: listParam(opened.filter((id) => id !== show.tmdbId)) });
      return;
    }
    router.setQuery({ open: listParam([...opened, show.tmdbId]) });
    showFailures = Object.fromEntries(
      Object.entries(showFailures).filter(([id]) => Number(id) !== show.tmdbId),
    );
    try {
      // Opening a show counts what it lacks, so the badge of the list is right afterwards.
      details = { ...details, [show.tmdbId]: await libraryItems.show(libraryId, show.tmdbId) };
      const counted = details[show.tmdbId]?.missing ?? null;
      if (shows) {
        shows = {
          ...shows,
          items: shows.items.map((s) =>
            s.tmdbId === show.tmdbId ? { ...s, missing: counted } : s,
          ),
        };
      }
    } catch (error) {
      showFailures = { ...showFailures, [show.tmdbId]: error };
    }
  }

  const seasonKey = (tmdbId: number, season: number): string => `${tmdbId}:${season}`;
  function toggleSeason(key: string): void {
    router.setQuery({
      seasons: listParam(
        seasonsOpen.includes(key) ? seasonsOpen.filter((k) => k !== key) : [...seasonsOpen, key],
      ),
    });
  }

  const mark = (value: boolean | null): string => (value === null ? '' : value ? '✓' : '✗');
  const columns = $derived(5 + (writes.nfo ? 1 : 0) + (writes.artwork ? 2 : 0));
</script>

{#if failure}
  <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
{:else if shows === undefined}
  <p class="muted" role="status">{t('web.loading')}</p>
{:else if shows.items.length === 0 && settling.length === 0}
  <p class="card muted">{t('web.library.empty')}</p>
{:else}
  <div class="layout">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t('web.library.col.title')}</th>
            <th>{t('web.library.col.year')}</th>
            <th>{t('web.library.col.seasons')}</th>
            <th>{t('web.library.col.episodes')}</th>
            {#if writes.nfo}<th>NFO</th>{/if}
            {#if writes.artwork}
              <th>{t('web.library.col.poster')}</th>
              <th>{t('web.library.col.fanart')}</th>
            {/if}
            <th>{t('web.library.col.missing')}</th>
          </tr>
        </thead>
        <tbody>
          {#if settling.length > 0}
            <tr class="group">
              <td colspan={columns}>
                <button
                  type="button"
                  class="link"
                  aria-expanded={settleOpen}
                  onclick={() => (settleOpen = !settleOpen)}
                >
                  <Chevron open={settleOpen} />
                  {t('web.library.shows.settle')}
                </button>
                <span class="chip chip-warn">{settleTotal}</span>
              </td>
            </tr>
            {#if settleOpen}
              {#each settling as item (item.id)}
                <tr
                  class="child"
                  class:current={selection?.kind === 'item' && selection.item.id === item.id}
                >
                  <td colspan={columns}>
                    <button
                      type="button"
                      class="link"
                      onclick={() => (selection = { kind: 'item', item })}
                    >
                      {item.path.split('/').pop()}
                    </button>
                    <span class="chip {item.state === 'review' ? 'chip-warn' : 'chip-danger'}"
                      >{t(
                        item.state === 'review'
                          ? 'web.library.state.review'
                          : 'web.library.state.unrecognized',
                      )}</span
                    >
                  </td>
                </tr>
              {/each}
            {/if}
          {/if}

          {#each shows.items as show (show.tmdbId)}
            {@const isOpen = opened.includes(show.tmdbId)}
            <tr class:current={selection?.kind === 'show' && selection.tmdbId === show.tmdbId}>
              <td>
                <button
                  type="button"
                  class="link"
                  aria-expanded={isOpen}
                  aria-label={t(isOpen ? 'web.library.shows.close' : 'web.library.shows.open', {
                    title: show.title ?? '',
                  })}
                  onclick={() => void toggle(show)}
                >
                  <Chevron open={isOpen} />
                  {show.title ?? ''}
                </button>
              </td>
              <td>{show.year ?? ''}</td>
              <td>{show.seasons}</td>
              <td>{show.episodes}</td>
              {#if writes.nfo}<td>{mark(show.nfo)}</td>{/if}
              {#if writes.artwork}
                <td>{mark(show.poster)}</td>
                <td>{mark(show.fanart)}</td>
              {/if}
              <td>
                {#if show.missing}
                  <span class="chip chip-warn"
                    >{t('web.library.shows.missing', { count: show.missing })}</span
                  >
                {/if}
              </td>
            </tr>

            {#if isOpen}
              {@const detail = details[show.tmdbId]}
              {@const showFailure = showFailures[show.tmdbId]}
              {#if detail === undefined && showFailure !== undefined}
                <tr class="child">
                  <td colspan={columns}>
                    <span class="alert alert-danger" role="alert">{messageOf(t, showFailure)}</span>
                  </td>
                </tr>
              {:else if detail === undefined}
                <tr class="child"><td colspan={columns} class="muted">{t('web.loading')}</td></tr>
              {:else}
                {#each detail.seasons as season (season.season)}
                  {@const key = seasonKey(show.tmdbId, season.season)}
                  {@const seasonOpen = seasonsOpen.includes(key)}
                  <!-- No file at all: TMDB lists episodes, the disk holds none. -->
                  {@const empty = !season.episodes.some(
                    ({ state }) => state === 'present' || state === 'extra',
                  )}
                  {@const present = season.episodes.filter((e) => e.state === 'present').length}
                  {@const listed = season.episodes.filter((e) => e.state !== 'extra').length}
                  <tr class="child season" class:empty>
                    <td colspan="4">
                      <button
                        type="button"
                        class="link indent"
                        aria-expanded={seasonOpen}
                        onclick={() => {
                          toggleSeason(key);
                        }}
                      >
                        <Chevron open={seasonOpen} />
                        {season.season === 0
                          ? t('web.library.season.specials')
                          : t('web.library.season', { season: season.season })}
                      </button>
                      {#if listed > 0}
                        <span
                          class="chip {present === 0
                            ? 'chip-neutral'
                            : present === listed
                              ? 'chip-ok'
                              : 'chip-warn'}">{present}/{listed}</span
                        >
                      {/if}
                    </td>
                    {#if writes.nfo}<td></td>{/if}
                    {#if writes.artwork}
                      <td>{mark(season.poster)}</td>
                      <td></td>
                    {/if}
                    <td>
                      {#if season.missing > 0}
                        <span class="chip chip-warn"
                          >{t('web.library.shows.missing', { count: season.missing })}</span
                        >
                      {/if}
                    </td>
                  </tr>
                  {#if seasonOpen}
                    {#each season.episodes as episode (`${episode.episode}:${episode.item?.id ?? ''}`)}
                      {@const item = episode.item}
                      <tr
                        class="child episode"
                        class:current={selection?.kind === 'item' && item?.id === selection.item.id}
                      >
                        <td class="indent2">
                          {#if item}
                            <button
                              type="button"
                              class="link"
                              onclick={() => (selection = { kind: 'item', item })}
                            >
                              {episodeLabel(episode.season, episode.episode)}
                              {episode.title ?? ''}
                            </button>
                          {:else}
                            <span class="muted">
                              {episodeLabel(episode.season, episode.episode)}
                              {episode.title ?? ''}
                            </span>
                          {/if}
                        </td>
                        <td class="muted">
                          {episode.airDate ? formatDay(episode.airDate, locale.value) : ''}
                        </td>
                        <td colspan="2">
                          {#if episode.state !== 'present'}
                            <span class="chip {EPISODE_CHIP[episode.state]}"
                              >{t(`web.library.episode.${episode.state}`)}</span
                            >
                          {/if}
                        </td>
                        {#if writes.nfo}<td>{mark(item?.nfo ?? null)}</td>{/if}
                        {#if writes.artwork}<td></td><td></td>{/if}
                        <td></td>
                      </tr>
                    {/each}
                  {/if}
                {/each}
                {#if !detail.determined}
                  <tr class="child">
                    <td colspan={columns} class="muted">{t('web.library.shows.undetermined')}</td>
                  </tr>
                {/if}
              {/if}
            {/if}
          {/each}
        </tbody>
      </table>
      {#if shows.total > shows.items.length}
        <button
          type="button"
          class="btn"
          onclick={() => {
            limit += PAGE_SIZE;
            void load();
          }}>{t('web.library.more', { shown: shows.items.length, total: shows.total })}</button
        >
      {/if}
    </div>

    <div class="side">
      {#if selection?.kind === 'item'}
        {#key selection.item.id}
          <ItemPanel
            {libraryId}
            item={selection.item}
            ondone={(message: string) => {
              selection = undefined;
              onsettled(message);
              void load();
            }}
          />
        {/key}
      {:else if chosenShow}
        {#key chosenShow.tmdbId}
          <ShowPanel show={chosenShow} detail={details[chosenShow.tmdbId]} />
        {/key}
      {:else}
        <p class="muted">{t('web.library.pick')}</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(280px, 1fr);
    gap: 16px;
    align-items: start;
  }

  /* Floats beside the tree while it scrolls; a tall panel scrolls on its own rather than past the screen. */
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

  .group td {
    background: var(--surface-2);
  }

  /* A season with no file reads as absent, not as a season like the others. */
  .season.empty .link {
    color: var(--muted);
    font-weight: 400;
  }

  .season.empty {
    opacity: 0.7;
  }

  .indent {
    padding-left: 16px;
  }

  .indent2 {
    padding-left: 36px;
  }

  p {
    margin: 0;
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

    .side {
      position: static;
      max-height: none;
      overflow-y: visible;
    }
  }
</style>
