<script lang="ts">
  import { baseName, rescanPath } from '../lib/paths.js';
  import { untrack } from 'svelte';
  import { ApiError } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { t } from '../lib/i18n.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { validations } from '../lib/validations.svelte.js';
  import { listOf, listParam } from '../lib/routes.js';
  import {
    PAGE_SIZE,
    episodeLabel,
    groupSettling,
    libraryItems,
    settleKey,
    thumbOf,
    type Coverage,
    type EpisodeState,
    type ShowEpisode,
    type LibraryItem,
    type Show,
    type ShowFilter,
    type ShowDetail,
  } from '../lib/library-items.js';
  import Chevron from './Chevron.svelte';
  import Presence from './Presence.svelte';
  import CoverageBadges from './CoverageBadges.svelte';
  import EpisodePanel from './EpisodePanel.svelte';
  import NfoTally from './NfoTally.svelte';
  import SlotBadges from './SlotBadges.svelte';
  import { slotsOf } from '../lib/versions.js';
  import ItemPanel from './ItemPanel.svelte';
  import RescanButton from './RescanButton.svelte';
  import RunDialog from './RunDialog.svelte';
  import ShowPanel from './ShowPanel.svelte';

  let {
    libraryId,
    source,
    writes,
    query,
    filter,
    onsettled,
    busy = false,
  }: {
    libraryId: string;
    /** The library's folder: what a scan of one show or season must stay inside. */
    source: string;
    writes: { nfo: boolean; artwork: boolean; logo: boolean; thumb: boolean };
    query: string;
    /** The tab: the shows it keeps, and the files waiting for a person (`review`, `unrecognized`). */
    filter: ShowFilter | undefined;
    /** A file was settled: what to tell the user, and the library to read again. */
    onsettled: (message: string) => void;
    /** A transfer is going on: nothing new is started until it ends. */
    busy?: boolean;
  } = $props();

  const EPISODE_CHIP: Record<Exclude<EpisodeState, 'present'>, string> = {
    missing: 'chip-warn',
    unaired: 'chip-neutral',
    extra: 'chip-danger',
  };

  type Selection =
    | { readonly kind: 'show'; readonly tmdbId: number }
    | { readonly kind: 'item'; readonly item: LibraryItem }
    | {
        readonly kind: 'episode';
        readonly tmdbId: number;
        readonly episode: ShowEpisode;
        /** The versions of the show, as its season lists them. */
        readonly coverage: readonly Coverage[];
      };

  let shows = $state<{ total: number; items: readonly Show[] } | undefined>(undefined);
  let settling = $state<readonly LibraryItem[]>([]);
  const settleGroups = $derived(groupSettling(settling));
  /** Groups whose validation went through: they stay locked until the list no longer holds them. */
  let startedKeys = $state<readonly string[]>([]);
  let details = $state<Readonly<Record<number, ShowDetail>>>({});
  /** A show that could not be opened says so in its own row: the rest of the tree stays. */
  let showFailures = $state<Readonly<Record<number, unknown>>>({});
  /** How many validations wait for a person (a release counts once), the server's count. */
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
  /** The shows ticked to rename or refresh, by TMDB id. */
  let picked = $state<readonly number[]>([]);
  let running = $state<{ mode: 'rename' | 'refresh'; items: readonly LibraryItem[] } | undefined>(
    undefined,
  );
  let starting = $state(false);
  let runFailure = $state<unknown>(undefined);

  // A show with nothing to rename or refresh has no checkbox.
  const runnable = $derived((shows?.items ?? []).filter((s) => s.rename + s.refresh > 0));
  const pickedShows = $derived(runnable.filter((s) => picked.includes(s.tmdbId)));
  const toRename = $derived(pickedShows.reduce((sum, s) => sum + s.rename, 0));
  const toRefresh = $derived(pickedShows.reduce((sum, s) => sum + s.refresh, 0));

  function pick(tmdbId: number, on: boolean): void {
    picked = on ? [...picked, tmdbId] : picked.filter((id) => id !== tmdbId);
  }

  /** The episodes of the ticked shows that the action takes, read from the library's list. */
  async function start(mode: 'rename' | 'refresh'): Promise<void> {
    // The shows ticked when the button was pressed: the list is read for a while, and a box
    // ticked meanwhile is not part of what was asked.
    const wanted = new Set(picked);
    starting = true;
    runFailure = undefined;
    try {
      // `incomplete` has no filter of its own: an episode can be so for a file that is no column of
      // its own (a show's NFO, a season's poster), which no `missing-*` filter would show.
      const page = await libraryItems.page(libraryId, {
        state: mode === 'rename' ? 'rename' : undefined,
        limit: 100_000,
      });
      const found = new Map(
        page.items
          .filter(
            (item) =>
              item.tmdbId !== null &&
              wanted.has(item.tmdbId) &&
              item.state === (mode === 'rename' ? 'rename' : 'incomplete'),
          )
          .map((item) => [item.id, item] as const),
      );
      // Never a click that does nothing: say so when the lists no longer hold what the counts did.
      if (found.size === 0) {
        throw new ApiError(409, 'library.nothing-to-do');
      }
      running = { mode, items: [...found.values()] };
    } catch (error) {
      runFailure = error;
    } finally {
      starting = false;
    }
  }

  const selectedItem = $derived(selection?.kind === 'item' ? selection.item : undefined);

  const chosenShow = $derived.by(() => {
    const chosen = selection;
    return chosen?.kind === 'show'
      ? shows?.items.find((show) => show.tmdbId === chosen.tmdbId)
      : undefined;
  });

  let latest = 0;
  async function load(wanted = { query, filter }): Promise<void> {
    const ticket = ++latest;
    try {
      // The files that wait for a person are one node at the top, never inside a show: the tabs
      // `review` and `unrecognized` list them alone, and the tab of every show lists both kinds.
      const waiting = (['review', 'unrecognized'] as const).filter(
        (state) => wanted.filter === undefined || wanted.filter === state,
      );
      const answer =
        wanted.filter === 'review' || wanted.filter === 'unrecognized'
          ? { total: 0, items: [] }
          : await libraryItems.shows(libraryId, {
              q: wanted.query,
              missing: wanted.filter === 'missing-episodes',
              incomplete: wanted.filter === 'missing-show-files',
              ...(wanted.filter !== undefined &&
                wanted.filter !== 'missing-episodes' &&
                wanted.filter !== 'missing-show-files' && { state: wanted.filter }),
              limit,
            });
      const pages = await Promise.all(
        waiting.map((state) =>
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
        const present = new Set(settling.map(settleKey));
        startedKeys = startedKeys.filter((key) => present.has(key));
        settleTotal = pages.reduce((sum, page) => sum + page.groups, 0);
        // Only what is open is kept: a closed show is read again when it opens.
        details = Object.fromEntries(
          Object.entries({
            ...details,
            ...Object.fromEntries(
              fresh.filter((entry): entry is [number, ShowDetail] => entry[1] !== null),
            ),
          }).filter(([id]) => opened.includes(Number(id))),
        ) as Record<number, ShowDetail>;
        failure = undefined;
      }
    } catch (error) {
      if (ticket === latest) {
        failure = error;
      }
    }
  }

  // The parent's search box and filter come through the props: read again when they change.
  // Not on the first run: `refetchOn` below reads it once.
  let mounted = false;
  $effect(() => {
    const [wantedQuery, wantedFilter] = [query, filter];
    untrack(() => {
      if (!mounted) {
        mounted = true;
        return;
      }
      limit = PAGE_SIZE;
      picked = [];
      void load({ query: wantedQuery, filter: wantedFilter });
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

  const columns = $derived(
    6 +
      (writes.nfo ? 1 : 0) +
      (writes.artwork ? 2 : 0) +
      (writes.logo ? 1 : 0) +
      (writes.thumb ? 1 : 0),
  );
</script>

{#if failure}
  <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
{:else if shows === undefined}
  <p class="muted" role="status">{t('web.loading')}</p>
{:else if shows.items.length === 0 && settling.length === 0}
  <p class="card muted">{t('web.library.empty')}</p>
{:else}
  {#if runFailure}
    <p class="alert alert-danger" role="alert">{messageOf(t, runFailure)}</p>
  {/if}
  {#if runnable.length > 0}
    <div class="bar" role="group">
      <label class="check">
        <input
          type="checkbox"
          checked={pickedShows.length === runnable.length}
          indeterminate={pickedShows.length > 0 && pickedShows.length < runnable.length}
          onchange={(event) => {
            picked = event.currentTarget.checked ? runnable.map((s) => s.tmdbId) : [];
          }}
        />
        {t('web.library.run.all')}
      </label>
      {#if pickedShows.length > 0}
        <span>{t('web.library.run.shows', { count: pickedShows.length })}</span>
        <button
          type="button"
          class="btn btn-primary"
          disabled={toRename === 0 || starting || busy}
          onclick={() => void start('rename')}
        >
          {t('web.library.run.rename')}
        </button>
        <button
          type="button"
          class="btn"
          disabled={toRefresh === 0 || starting || busy}
          onclick={() => void start('refresh')}
        >
          {t('web.library.run.refresh')}
        </button>
      {/if}
    </div>
  {/if}
  <div class="layout">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t('web.library.col.title')}</th>
            <th>{t('web.library.col.year')}</th>
            <th>{t('web.library.col.seasons')}</th>
            <th>{t('web.library.col.episodes')}</th>
            <th>{t('web.library.col.versions')}</th>
            {#if writes.nfo}<th>NFO</th>{/if}
            {#if writes.artwork}
              <th>{t('web.library.col.poster')}</th>
              <th>{t('web.library.col.fanart')}</th>
            {/if}
            {#if writes.logo}<th>{t('web.library.col.logo')}</th>{/if}
            {#if writes.thumb}<th>{t('web.library.col.thumb')}</th>{/if}
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
              {#each settleGroups as group (group.key)}
                {@const lead = group.items[0]}
                {@const started = startedKeys.includes(group.key)}
                {@const ids = group.items.map((item) => item.entryId)}
                {@const validating = validations.anyRunning(ids)}
                {@const failed = validations.firstFailure(ids)}
                {#if lead}
                  <tr
                    class="child"
                    class:current={selection?.kind === 'item' &&
                      group.items.some((item) => item.id === selectedItem?.id)}
                  >
                    <td colspan={columns}>
                      {#if started}
                        <span class="muted">{baseName(group.name)}</span>
                        <span class="chip chip-neutral">{t('web.library.settle.started')}</span>
                      {:else}
                        <button
                          type="button"
                          class="link"
                          onclick={() => (selection = { kind: 'item', item: lead })}
                        >
                          {baseName(group.name)}
                        </button>
                        <span class="chip {lead.state === 'review' ? 'chip-warn' : 'chip-danger'}"
                          >{t(
                            lead.state === 'review'
                              ? 'web.library.state.review'
                              : 'web.library.state.unrecognized',
                          )}</span
                        >
                        {#if validating}<span class="chip chip-neutral"
                            >{t('web.queue.validating')}</span
                          >{:else if failed}<span class="chip chip-danger" role="alert"
                            >{messageOf(t, failed.error)}</span
                          >{/if}
                        {#if group.detached}<span class="chip chip-neutral"
                            >{t('web.arrivals.detached')}</span
                          >{/if}
                        {#if group.files > 1}<span class="muted"
                            >{t('web.arrivals.files', { count: group.files })}</span
                          >{/if}
                      {/if}
                    </td>
                  </tr>
                {/if}
              {/each}
            {/if}
          {/if}

          {#each shows.items as show (show.tmdbId)}
            {@const isOpen = opened.includes(show.tmdbId)}
            <tr class:current={selection?.kind === 'show' && selection.tmdbId === show.tmdbId}>
              <td>
                <div class="name">
                  <!-- Always there, so the titles of the shows without a box stay in line. -->
                  <span class="box">
                    {#if show.rename + show.refresh > 0}
                      <input
                        type="checkbox"
                        aria-label={t('web.library.run.select', { name: show.title ?? '' })}
                        checked={picked.includes(show.tmdbId)}
                        onchange={(event) => {
                          pick(show.tmdbId, event.currentTarget.checked);
                        }}
                      />
                    {/if}
                  </span>
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
                </div>
              </td>
              <td>{show.year ?? ''}</td>
              <td>{show.seasons}</td>
              <td>
                {show.episodes}
                {#if show.versions.length > 1}
                  <span class="muted" aria-hidden="true">×{show.versions.length}</span>
                  <span class="sr-only"
                    >, {t('web.library.versions.count', { count: show.versions.length })}</span
                  >
                {/if}
              </td>
              <td><CoverageBadges coverage={show.versions} /></td>
              {#if writes.nfo}
                <td>
                  <Presence value={show.nfo} />
                  {#if show.episodesLackingNfo > 0}
                    <span
                      class="chip chip-warn"
                      title={t('web.library.shows.nfo-lacking.hint', {
                        count: show.episodesLackingNfo,
                      })}
                      >{t('web.library.shows.nfo-lacking', {
                        count: show.episodesLackingNfo,
                      })}</span
                    >
                  {/if}
                </td>
              {/if}
              {#if writes.artwork}
                <td><Presence value={show.poster} /></td>
                <td><Presence value={show.fanart} /></td>
              {/if}
              {#if writes.logo}<td><Presence value={show.logo} /></td>{/if}
              {#if writes.thumb}<td></td>{/if}
              <td>
                {#if show.missing}
                  <!-- The column's header says what it counts; the tooltip spells it out. -->
                  <span
                    class="chip chip-warn"
                    title={t('web.library.shows.missing', { count: show.missing })}
                    >{show.missing}</span
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
                  <!-- Versions of one episode are several rows: count the episodes, not the files. -->
                  {@const present = new Set(
                    season.episodes.filter((e) => e.state === 'present').map((e) => e.episode),
                  ).size}
                  {@const listed = new Set(
                    season.episodes.filter((e) => e.state !== 'extra').map((e) => e.episode),
                  ).size}
                  <tr class="child season" class:empty>
                    <td colspan="3">
                      <div class="season-head">
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
                        <RescanButton
                          compact
                          {libraryId}
                          path={rescanPath(
                            season.episodes.flatMap(({ versions }) =>
                              versions.map((version) => version.path),
                            ),
                            source,
                          )}
                          name={`${show.title ?? ''} · ${season.season === 0 ? t('web.library.season.specials') : t('web.library.season', { season: season.season })}`}
                          ondone={(message: string) => {
                            onsettled(message);
                            void load();
                          }}
                        />
                      </div>
                    </td>
                    <td>
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
                    <td
                      >{#if !empty}<CoverageBadges coverage={season.versions} always />{/if}</td
                    >
                    {#if writes.nfo}<td><NfoTally tally={season.nfo} always /></td>{/if}
                    {#if writes.artwork}
                      <td><Presence value={season.poster} /></td>
                      <td></td>
                    {/if}
                    {#if writes.logo}<td></td>{/if}
                    {#if writes.thumb}<td></td>{/if}
                    <td>
                      {#if season.missing > 0}
                        <span
                          class="chip chip-warn"
                          title={t('web.library.shows.missing', { count: season.missing })}
                          >{season.missing}</span
                        >
                      {/if}
                    </td>
                  </tr>
                  {#if seasonOpen}
                    {#each season.episodes as episode (episode.episode)}
                      {@const item = episode.versions[0]}
                      <tr
                        class="child episode"
                        class:current={selection?.kind === 'episode' &&
                          selection.episode.season === episode.season &&
                          selection.episode.episode === episode.episode}
                      >
                        <td class="indent2" colspan="3">
                          {#if item}
                            <button
                              type="button"
                              class="link"
                              onclick={() =>
                                (selection = {
                                  kind: 'episode',
                                  tmdbId: show.tmdbId,
                                  episode,
                                  coverage: season.versions,
                                })}
                            >
                              <span class="code"
                                >{episodeLabel(episode.season, episode.episode)}</span
                              >
                              {episode.title ?? ''}
                            </button>
                          {:else}
                            <span class="muted row-title">
                              <span class="code"
                                >{episodeLabel(episode.season, episode.episode)}</span
                              >
                              {episode.title ?? ''}
                            </span>
                          {/if}
                        </td>
                        <!-- The tag sits in the "Episodes" column. An episode no file holds has nothing after it: the cell takes the rest of the row, so the tag has room. -->
                        <td colspan={item ? 1 : columns - 3}>
                          <!-- In a season no file holds, every episode is missing: the season says it once. -->
                          {#if episode.state !== 'present' && !(empty && episode.state === 'missing')}
                            <span class="chip {EPISODE_CHIP[episode.state]}"
                              >{t(`web.library.episode.${episode.state}`)}</span
                            >
                          {/if}
                        </td>
                        {#if item}
                          <td>
                            <SlotBadges slots={slotsOf(season.versions, episode.versions)} />
                          </td>
                          {#if writes.nfo}<td><NfoTally tally={episode.nfo} /></td>{/if}
                          {#if writes.artwork}<td></td><td></td>{/if}
                          {#if writes.logo}<td></td>{/if}
                          {#if writes.thumb}<td><Presence value={thumbOf(episode.versions)} /></td
                            >{/if}
                          <td></td>
                        {/if}
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
        {@const chosenItem = selection.item}
        {#key chosenItem.id}
          <ItemPanel
            {libraryId}
            {source}
            item={chosenItem}
            {busy}
            siblings={settleGroups.find((group) => group.key === settleKey(chosenItem))?.files ?? 1}
            ondone={(message: string, settled?: { readonly id: string; readonly key: string }) => {
              // A validation lets the whole group go: lock it until the transfer empties the list.
              // The group is the one validated, as read at the click: by now the list may have
              // dropped it, and the row open is another one.
              if (settled) {
                startedKeys = [...startedKeys, settled.key];
              }
              // Close the panel only if it still shows what was validated.
              if (
                selection?.kind === 'item' &&
                (settled === undefined || settleKey(selection.item) === settled.key)
              ) {
                selection = undefined;
              }
              onsettled(message);
              void load();
            }}
          />
        {/key}
      {:else if selection?.kind === 'episode'}
        {@const chosen = selection}
        {#key `${chosen.episode.season}:${chosen.episode.episode}`}
          <EpisodePanel
            {libraryId}
            tmdbId={chosen.tmdbId}
            showTitle={shows.items.find((show) => show.tmdbId === chosen.tmdbId)?.title ?? ''}
            episode={chosen.episode}
            coverage={chosen.coverage}
            {busy}
            ondone={(message: string) => {
              selection = undefined;
              onsettled(message);
              void load();
            }}
            onimage={(message: string) => {
              // The episode stays selected: only the lists behind it are read again.
              onsettled(message);
              void load();
            }}
          />
        {/key}
      {:else if chosenShow}
        {#key chosenShow.tmdbId}
          <ShowPanel
            {libraryId}
            {source}
            show={chosenShow}
            detail={details[chosenShow.tmdbId]}
            ondone={(message: string) => {
              onsettled(message);
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

{#if running && running.items.length > 0}
  <RunDialog
    {libraryId}
    items={running.items}
    mode={running.mode}
    onclose={() => {
      running = undefined;
    }}
    ondone={(message: string) => {
      picked = [];
      running = undefined;
      onsettled(message);
    }}
  />
{/if}

<style>
  .name {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* The arrow stays on the first line of a title that wraps, rather than standing alone above it. */
  .name .link,
  .season-head .link {
    display: flex;
    align-items: center;
  }

  /* The title wraps, the button never does: both stay on one line while the cell has room. */
  .season-head {
    display: flex;
    align-items: center;
  }

  .season-head :global(.btn) {
    flex: none;
    white-space: nowrap;
  }

  th:first-child {
    min-width: 200px;
  }

  .box {
    display: inline-flex;
    flex: none;
    width: 16px;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* The count of what is ticked, set apart from the "select all" box before it. */
  .bar > span {
    margin-left: 4px;
    padding-left: 12px;
    border-left: 1px solid var(--border-strong);
  }

  .layout {
    display: grid;
    /* The tree takes what the panel does not need: extra width goes to the columns. */
    grid-template-columns: minmax(0, 1fr) minmax(340px, 36%);
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

  /* An inset shadow, not a border: a border on a row of a collapsed table is not drawn everywhere. */
  tr.current > :first-child {
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .code {
    color: var(--muted);
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

  /* A show's arrow sits after its select box (16px + 8px gap), so the seasons start further in than that. */
  .indent {
    padding-left: 40px;
  }

  /* As tall as the title of an episode that has a file (a 44px button), so the rows read evenly. */
  .row-title {
    display: inline-flex;
    align-items: center;
    /* A flex container drops the space between the code and the title. */
    gap: 0.3em;
    min-height: 44px;
  }

  .indent2 {
    padding-left: 60px;
  }

  p {
    margin: 0;
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
