<script lang="ts">
  import { imageUrl } from '../lib/arrivals.js';
  import { api } from '../lib/api.js';
  import { MediaQuery } from 'svelte/reactivity';
  import PanelSheet from './PanelSheet.svelte';
  import { messageOf } from '../lib/errors.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { formatDate } from '../lib/history.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import {
    COLLECTION_IMAGE_TYPES,
    collectionBase,
    COLLECTION_VIEW_FILTERS,
    canAdopt,
    canSend,
    isDue,
    isWaiting,
    collectionImageUrl,
    collectionsApi,
    completenessOf,
    filterCounts,
    matchesFilter,
    sendSummary,
    serverStatus,
    serversToSend,
    type CollectionCard,
    type CollectionImageType,
    type CollectionViewFilter,
    type CollectionsPage,
    type MediaServer,
    type SendTask,
  } from '../lib/collections.js';
  import type { HealthReport } from '../lib/health.js';
  import type { Library } from '../lib/libraries.js';
  import { resource } from '../lib/resource.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import ImagesDialog from './ImagesDialog.svelte';
  import CollectionRenameDialog from './CollectionRenameDialog.svelte';
  import Link from './Link.svelte';

  let { library }: { library: Library } = $props();

  const TOPICS = ['jobs', 'history', 'progress', 'settings', 'ready'] as const;
  const list = resource<CollectionsPage>(() => collectionsApi.list(library.id), TOPICS);
  const report = resource<HealthReport>(
    () => api.get<HealthReport>('/api/health/report'),
    ['health', 'settings', 'ready'],
  );

  let filter = $state<CollectionViewFilter>('all');
  let notice = $state<readonly string[]>([]);
  let noticeLevel = $state<'ok' | 'warn' | 'danger'>('ok');
  let failure = $state<unknown>(undefined);
  let task = $state<SendTask | undefined>(undefined);
  let choosing = $state<CollectionImageType | undefined>(undefined);
  // Below this width the panel sits under the list (the layout's own media query, below).
  const narrow = new MediaQuery('max-width: 960px');
  let renaming = $state(false);
  let chooseButton = $state<HTMLElement | undefined>(undefined);

  const cards = $derived(list.value?.collections ?? []);
  const counts = $derived(filterCounts(cards));
  const shown = $derived(cards.filter((card) => matchesFilter(card, filter)));
  const key = $derived(router.query.get('collection') ?? undefined);
  const selected = $derived(cards.find((card) => card.key === key));
  const servers = $derived(list.value?.servers ?? []);
  const sending = $derived(task?.status === 'running');
  /** What the header's button sends: what can go now. A collection a server lacks cannot. */
  const toSendCount = $derived(cards.filter(isDue).length);
  /** Collections whose TMDB image could be chosen in one go. */
  const toAdoptCount = $derived(cards.filter(canAdopt).length);
  const waitingCount = $derived(cards.filter(isWaiting).length);

  const serverName = (kind: MediaServer): string => (kind === 'plex' ? 'Plex' : 'Jellyfin');
  const namesOf = (kinds: readonly MediaServer[]): string =>
    kinds.map(serverName).join(t('web.collections.and'));

  const lastRefresh = (kind: MediaServer) =>
    report.value?.notify.recent.find((record) => record.kind === kind);

  function select(next: CollectionCard): void {
    router.setQuery({ collection: next.key });
  }

  // ---- Sending, a background task the page follows through the `progress` event ----

  async function readTask(): Promise<void> {
    try {
      const { send } = await collectionsApi.sendState(library.id);
      if (!send) {
        return;
      }
      const wasRunning = task?.status === 'running';
      // A task already over when the page opens is not shown again.
      if (send.status === 'running' || wasRunning) {
        task = send;
      }
      if (wasRunning && send.status !== 'running') {
        finished(send);
      }
    } catch (error) {
      failure = error;
    }
  }

  function finished(done: SendTask): void {
    if (done.status === 'failed') {
      failure = done.error
        ? { status: 0, code: done.error.code, params: done.error.params }
        : undefined;
    }
    const summary = sendSummary(done.outcomes, t);
    const chosen = done.outcomes.reduce((sum, outcome) => sum + outcome.chosen, 0);
    noticeLevel = summary.level;
    notice =
      chosen > 0
        ? [t('web.collections.adopt.done', { count: chosen }), ...summary.lines]
        : summary.lines.length > 0
          ? summary.lines
          : [t('web.collections.send.nothing')];
    void list.reload();
  }

  async function start(keys?: readonly string[]): Promise<void> {
    failure = undefined;
    notice = [];
    noticeLevel = 'ok';
    try {
      task = await collectionsApi.send(library.id, keys);
    } catch (error) {
      failure = error;
    }
  }

  async function adopt(): Promise<void> {
    failure = undefined;
    notice = [];
    noticeLevel = 'ok';
    try {
      task = await collectionsApi.adoptTmdb(library.id);
    } catch (error) {
      failure = error;
    }
  }

  refetchOn(['progress'], () => {
    if (task?.status === 'running') {
      void readTask();
    }
  });
  // Resumes a send started from another tab or before a reload.
  void readTask();

  // ---- Choosing an image ----

  async function drop(card: CollectionCard, type: CollectionImageType): Promise<void> {
    failure = undefined;
    try {
      await collectionsApi.drop(library.id, card.key, type);
      noticeLevel = 'ok';
      notice = [t('web.collections.image.dropped')];
      await list.reload();
    } catch (error) {
      failure = error;
    }
  }

  function source(card: CollectionCard, type: CollectionImageType): string {
    const image = card.images[type];
    if (!image) {
      return t('web.collections.image.none');
    }
    if (image.source.type === 'film') {
      return t('web.collections.source.film', { title: image.source.label ?? '' });
    }
    if (image.source.type === 'url') {
      return t('web.collections.source.url');
    }
    const names = new Intl.DisplayNames([locale.value], { type: 'language', fallback: 'code' });
    return t('web.collections.source.tmdb.short', {
      language:
        image.source.language === null
          ? t('web.images.language.none')
          : (names.of(image.source.language) ?? image.source.language),
    });
  }

  const imageSrc = (card: CollectionCard, type: CollectionImageType): string | undefined => {
    const image = card.images[type];
    return image
      ? collectionImageUrl(library.id, card.key, type, image.hash)
      : imageUrl(type === 'poster' ? 'w342' : 'w780', card.tmdbImages[type]);
  };
  // TMDB's own image, drawn while none is chosen: dimmed and tagged, as a movie's page does.
  const isPreview = (card: CollectionCard, type: CollectionImageType): boolean =>
    !card.images[type] && card.tmdbImages[type] !== null;

  function statusText(card: CollectionCard): string {
    return t(`web.collections.status.${card.status}`);
  }

  function viewFilms(card: CollectionCard): void {
    router.setQuery({ vue: undefined, collection: card.key });
  }

  function whenLabel(iso: string | null): string {
    return iso === null ? '' : formatDate(iso, locale.value);
  }
</script>

<div class="stack">
  <section class="servers card" aria-label={t('web.collections.servers.title')}>
    <div class="connections">
      {#if report.value && servers.length === 0}
        <p class="muted">{t('web.health.media.off')}</p>
      {/if}
      {#each servers as kind (kind)}
        {@const last = lastRefresh(kind)}
        <p class="connection">
          <span class="dot" class:warn={last?.ok === false} aria-hidden="true"></span>
          <span>{t(`web.health.media.${kind}`)}</span>
          {#if last}
            <span class="muted"
              >· {last.ok
                ? t('web.health.media.ok')
                : t('web.health.media.failed', { count: last.failed ?? 1 })}</span
            >
          {/if}
        </p>
      {/each}
      {#if waitingCount > 0}
        <p class="muted waiting">{t('web.collections.waiting', { count: waitingCount })}</p>
      {/if}
    </div>
    {#if toAdoptCount > 0}
      <button type="button" class="btn" disabled={sending} onclick={() => void adopt()}>
        {t('web.collections.adopt.all', { count: toAdoptCount })}
      </button>
    {/if}
    {#if toSendCount > 0}
      <button type="button" class="btn btn-primary" disabled={sending} onclick={() => void start()}>
        {sending
          ? t('web.collections.send.running', {
              done: task?.done ?? 0,
              total: Math.max(task?.total ?? 0, 1),
            })
          : t('web.collections.send.all', { count: toSendCount })}
      </button>
    {/if}
  </section>

  {#if notice.length > 0}
    <div
      class="alert"
      class:notice={noticeLevel === 'ok'}
      class:alert-warn={noticeLevel === 'warn'}
      class:alert-danger={noticeLevel === 'danger'}
      role={noticeLevel === 'danger' ? 'alert' : 'status'}
    >
      {#each notice as line (line)}<p>{line}</p>{/each}
    </div>
  {/if}
  {#if failure ?? list.failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure ?? list.failure)}</p>
  {/if}

  {#if list.value === undefined}
    {#if !list.failure}<p class="muted" role="status">{t('web.loading')}</p>{/if}
  {:else if cards.length === 0}
    <p class="card muted">{t('web.collections.empty')}</p>
  {:else}
    <div class="filters" role="group" aria-label={t('web.collections.filters')}>
      {#each COLLECTION_VIEW_FILTERS as option (option)}
        <button
          type="button"
          class="btn chip-btn"
          aria-pressed={filter === option}
          onclick={() => {
            filter = option;
          }}
        >
          {t(`web.collections.filter.${option}`)}
          <span class="count" class:todo={option === 'pending' && counts[option] > 0}
            >{counts[option]}</span
          >
        </button>
      {/each}
    </div>

    <div class="layout">
      {#if shown.length === 0}
        <p class="card muted">{t('web.collections.empty.filtered')}</p>
      {:else}
        <ul class="grid" aria-label={t('web.collections.grid')}>
          {#each shown as card (card.key)}
            {@const pill = completenessOf(card)}
            {@const poster = imageSrc(card, 'poster')}
            <li>
              <button
                type="button"
                class="card-btn"
                class:current={card.key === key}
                aria-pressed={card.key === key}
                onclick={() => {
                  select(card);
                }}
              >
                <span class="cover" aria-hidden="true">
                  {#if poster}<img
                      class:preview={isPreview(card, 'poster')}
                      src={poster}
                      alt=""
                      loading="lazy"
                    />{/if}
                </span>
                <span class="name">{card.name}</span>
                <span class="meta">
                  <span class="chip chip-{pill.kind}"
                    >{pill.custom
                      ? t('web.collections.custom.count', { count: card.held })
                      : pill.text}</span
                  >
                  <span class="status status-{card.status}">{statusText(card)}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <PanelSheet
        open={selected !== undefined}
        stacked={narrow.current}
        onclose={() => {
          router.setQuery({ collection: undefined });
        }}
      >
        {#if selected}
          {#key selected.key}
            {@const pill = completenessOf(selected)}
            {@const toSend = serversToSend(selected)}
            <article class="card detail" aria-labelledby="collection-name">
              <div class="banner" class:empty={!imageSrc(selected, 'fanart')}>
                <button
                  type="button"
                  class="banner-btn"
                  aria-label={t('web.collections.image.change.label', {
                    type: t('web.collections.type.fanart'),
                    name: selected.name,
                  })}
                  onclick={(event) => {
                    chooseButton = event.currentTarget;
                    choosing = 'fanart';
                  }}
                >
                  {#if imageSrc(selected, 'fanart')}<img
                      class:preview={isPreview(selected, 'fanart')}
                      src={imageSrc(selected, 'fanart')}
                      alt=""
                    />{/if}
                  {#if isPreview(selected, 'fanart')}<span class="preview-tag"
                      >{t('web.images.preview')}</span
                    >{/if}
                  <span class="pill" aria-hidden="true">{t('web.images.change-fanart')}</span>
                </button>
                <button
                  type="button"
                  class="poster-btn"
                  aria-label={t('web.collections.image.change.label', {
                    type: t('web.collections.type.poster'),
                    name: selected.name,
                  })}
                  onclick={(event) => {
                    chooseButton = event.currentTarget;
                    choosing = 'poster';
                  }}
                >
                  {#if imageSrc(selected, 'poster')}<img
                      class:preview={isPreview(selected, 'poster')}
                      src={imageSrc(selected, 'poster')}
                      alt=""
                    />{/if}
                  {#if isPreview(selected, 'poster')}<span class="preview-tag"
                      >{t('web.images.preview')}</span
                    >{/if}
                  <span class="veil" aria-hidden="true">{t('web.images.change-poster')}</span>
                </button>
              </div>

              <header>
                <h3 id="collection-name">{selected.name}</h3>
                <p class="muted">
                  {selected.custom
                    ? t('web.collections.sub.custom', { count: selected.held })
                    : t('web.collections.sub.tmdb', {
                        id: selected.tmdbId ?? 0,
                        held: selected.held,
                        total: selected.total ?? selected.held,
                      })}
                  <span class="chip chip-{pill.kind}"
                    >{pill.custom
                      ? t('web.collections.custom.count', { count: selected.held })
                      : pill.text}</span
                  >
                </p>
              </header>

              <section aria-labelledby="films-title">
                <div class="between">
                  <h4 id="films-title">{t('web.collections.films')}</h4>
                  <button
                    type="button"
                    class="link show"
                    onclick={() => {
                      viewFilms(selected);
                    }}>{t('web.collections.films.show')}</button
                  >
                </div>
                <ul class="films">
                  {#each selected.films as film (film.tmdbId ?? film.title)}
                    <li class:absent={!film.present}>
                      {#if film.present}
                        <span class="tick" aria-hidden="true">✓</span>
                        <span class="sr-only">{t('web.collection.part.present')}</span>
                      {/if}
                      <span>{film.title}{film.year ? ` (${film.year})` : ''}</span>
                      {#if !film.present}
                        <span class="chip chip-warn">{t('web.collection.part.missing')}</span>
                      {/if}
                    </li>
                  {/each}
                </ul>
              </section>

              <section aria-labelledby="collection-images-heading">
                <h4 id="collection-images-heading">{t('web.collections.images')}</h4>
                <ul class="images">
                  {#each COLLECTION_IMAGE_TYPES as type (type)}
                    {@const src = imageSrc(selected, type)}
                    <li>
                      <button
                        type="button"
                        class="thumb zone"
                        class:wide={type === 'fanart'}
                        aria-label={t('web.collections.image.change.label', {
                          type: t(`web.collections.type.${type}`),
                          name: selected.name,
                        })}
                        onclick={(event) => {
                          chooseButton = event.currentTarget;
                          choosing = type;
                        }}
                      >
                        {#if src}<img class:preview={isPreview(selected, type)} {src} alt="" />{/if}
                        <span class="veil" aria-hidden="true"
                          >{t(
                            type === 'poster'
                              ? 'web.images.change-poster'
                              : 'web.images.change-fanart',
                          )}</span
                        >
                      </button>
                      <span class="what">
                        <strong>{t(`web.collections.type.${type}`)}</strong>
                        <span class="muted">{source(selected, type)}</span>
                      </span>
                      <span class="row-actions">
                        {#if selected.images[type]}
                          <button
                            type="button"
                            class="btn"
                            onclick={() => void drop(selected, type)}
                            >{t('web.collections.image.drop')}</button
                          >
                        {/if}
                      </span>
                    </li>
                  {/each}
                </ul>
                <p class="muted note">{t('web.collections.image.keep')}</p>
              </section>

              <section aria-labelledby="servers-title">
                <h4 id="servers-title">{t('web.collections.on-servers')}</h4>
                {#if selected.servers.length === 0}
                  <p class="muted">
                    {t('web.collections.servers.none')}
                    <Link href="/settings#plex">{t('web.collections.servers.settings')}</Link>
                  </p>
                {:else}
                  <ul class="server-list">
                    {#each selected.servers as server (server.kind)}
                      {@const status = serverStatus(server.states)}
                      <li>
                        <div class="between">
                          <strong>{serverName(server.kind)}</strong>
                          <span
                            class="chip chip-{status.state === 'sent'
                              ? 'ok'
                              : status.state === 'error'
                                ? 'danger'
                                : status.state === 'pending' || status.state === 'missing'
                                  ? 'warn'
                                  : 'neutral'}">{t(`web.collections.state.${status.state}`)}</span
                          >
                        </div>
                        <p class="muted">
                          {t(`web.collections.explain.${status.state}`, {
                            server: serverName(server.kind),
                            when: whenLabel(status.at),
                          })}
                        </p>
                        {#if status.state === 'error' && status.message}
                          <p class="problem" role="alert">{status.message}</p>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                  <button
                    type="button"
                    class="btn btn-primary"
                    disabled={!canSend(selected) || sending}
                    onclick={() => void start([selected.key])}
                  >
                    {canSend(selected)
                      ? t('web.collections.send.one', { servers: namesOf(toSend) })
                      : t('web.collections.send.none')}
                  </button>
                {/if}
              </section>

              {#if selected.custom}
                <section>
                  <button
                    type="button"
                    class="btn"
                    aria-haspopup="dialog"
                    onclick={(event) => {
                      chooseButton = event.currentTarget;
                      renaming = true;
                    }}>{t('web.collections.rename')}</button
                  >
                </section>
              {/if}
            </article>
          {/key}
        {:else}
          <p class="muted">{t('web.collections.pick')}</p>
        {/if}
      </PanelSheet>
    </div>
  {/if}
</div>

{#if choosing && selected}
  <ImagesDialog
    base={collectionBase(library.id, selected.key)}
    initial={choosing}
    kinds={COLLECTION_IMAGE_TYPES}
    heading={selected.name}
    collection={{ libraryId: library.id, card: selected }}
    onclose={() => {
      choosing = undefined;
      chooseButton?.focus();
    }}
    ondone={(message: string) => {
      noticeLevel = 'ok';
      notice = [message];
      void list.reload();
    }}
  />
{/if}

{#if renaming && selected}
  <CollectionRenameDialog
    libraryId={library.id}
    collection={selected}
    onclose={() => {
      renaming = false;
      chooseButton?.focus();
    }}
    ondone={(next: string, message: string) => {
      noticeLevel = 'ok';
      notice = [message];
      router.setQuery({ collection: next });
      void list.reload();
    }}
  />
{/if}

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .servers {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 24px;
    padding: 14px 18px;
  }

  .connections {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 24px;
  }

  p {
    margin: 0;
  }

  .waiting {
    flex-basis: 100%;
    font-size: 13px;
  }

  .connection {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--ok);
  }

  .dot.warn {
    background: var(--warn);
  }

  .notice p + p {
    margin-top: 4px;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .chip-btn[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--surface-2);
  }

  .count {
    color: var(--muted);
    font-weight: 600;
  }

  .count.todo {
    color: var(--warn);
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(360px, 38%);
    gap: 16px;
    align-items: start;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .card-btn {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    min-height: 44px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }

  .card-btn:hover {
    border-color: var(--border-strong);
  }

  .card-btn.current {
    border-color: var(--accent);
    background: var(--surface-2);
  }

  .cover {
    display: block;
    aspect-ratio: 2 / 3;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: repeating-linear-gradient(
      135deg,
      var(--surface-2) 0 10px,
      var(--neutral-bg) 10px 20px
    );
  }

  img.preview {
    opacity: 0.55;
  }

  .preview-tag {
    position: absolute;
    left: 6px;
    top: 6px;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
    background: rgb(20 22 27 / 0.85);
    color: #fff;
    pointer-events: none;
  }

  /* The poster is narrow: the tag is centred on it and wraps instead of running past its edges. */
  .poster-btn .preview-tag {
    left: 4px;
    right: 4px;
    top: auto;
    bottom: 4px;
    padding: 1px 2px;
    font-size: 10px;
    line-height: 1.2;
    text-align: center;
  }

  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .meta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .status {
    color: var(--muted);
    font-size: 12px;
  }

  .status-pending,
  .status-missing {
    color: var(--warn);
  }

  .status-error {
    color: var(--danger);
  }

  .status-sent {
    color: var(--ok);
  }

  .detail {
    gap: 16px;
  }

  .banner {
    position: relative;
    height: 150px;
    margin-bottom: 36px;
    border-radius: var(--radius-sm);
    background: repeating-linear-gradient(
      135deg,
      var(--surface-2) 0 10px,
      var(--neutral-bg) 10px 20px
    );
  }

  .banner-btn {
    position: relative;
  }

  .banner-btn {
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
  }

  .banner-btn img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .zone {
    position: relative;
    color: #fff;
  }

  .veil {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    background: rgb(10 12 16 / 0.6);
    font-size: 11px;
    font-weight: 600;
    line-height: 1.2;
    text-align: center;
    opacity: 0;
  }

  .pill {
    position: absolute;
    top: 10px;
    right: 10px;
    display: flex;
    align-items: center;
    min-height: 36px;
    padding: 0 14px;
    border-radius: 18px;
    background: rgb(20 22 27 / 0.88);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    opacity: 0;
  }

  .banner-btn:hover .pill,
  .banner-btn:focus-visible .pill,
  .zone:hover .veil,
  .zone:focus-visible .veil,
  .poster-btn:hover .veil,
  .poster-btn:focus-visible .veil {
    opacity: 1;
  }

  .poster-btn {
    position: absolute;
    bottom: -32px;
    left: 16px;
    width: 72px;
    height: 108px;
    padding: 0;
    overflow: hidden;
    border: 2px solid var(--surface);
    border-radius: 6px;
    background: var(--surface-2);
    cursor: pointer;
  }

  .poster-btn img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  header {
    padding-left: 96px;
    min-height: 40px;
  }

  h3,
  h4 {
    margin: 0;
  }

  h3 {
    font-size: 17px;
  }

  h4 {
    font-size: 12px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--muted);
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .between {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .show {
    min-height: 0;
    color: var(--accent-text);
    text-decoration: underline;
  }

  .films,
  .images,
  .server-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .films li {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .films li.absent {
    color: var(--muted);
  }

  .tick {
    color: var(--ok);
    font-weight: 700;
  }

  .images li {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .thumb {
    display: block;
    flex: none;
    padding: 0;
    border: 0;
    cursor: pointer;
    width: 56px;
    height: 84px;
    overflow: hidden;
    border-radius: 4px;
    background: var(--surface-2);
  }

  .thumb.wide {
    width: 80px;
    height: 45px;
  }

  /* A small poster: the label is smaller and darker so that it reads over any picture. */
  .thumb .veil {
    padding: 2px;
    background: rgb(10 12 16 / 0.8);
    font-size: 10px;
    overflow-wrap: anywhere;
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .what {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    font-size: 13px;
  }

  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .note {
    font-size: 12px;
  }

  .server-list li {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .problem {
    color: var(--danger);
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  @media (max-width: 960px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
