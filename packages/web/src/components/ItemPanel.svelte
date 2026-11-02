<script lang="ts">
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import type { Arrival } from '../lib/arrivals.js';
  import {
    canRun,
    formatSize,
    libraryItems,
    type ItemDetail,
    type LibraryItem,
  } from '../lib/library-items.js';
  import ArrivalDetail from './ArrivalDetail.svelte';
  import RunDialog from './RunDialog.svelte';
  import Link from './Link.svelte';

  let {
    libraryId,
    item,
    ondone,
  }: {
    libraryId: string;
    item: LibraryItem;
    /** The file was settled (transferred or set aside): what to tell the user. */
    ondone: (message: string) => void;
  } = $props();

  // The parent keys this panel on the item, so what is read here once is right for its life.
  /* svelte-ignore state_referenced_locally */
  const settling = item.state === 'review' || item.state === 'unrecognized';
  let detail = $state<ItemDetail | undefined>(undefined);
  let entry = $state<Arrival | undefined>(undefined);
  let failure = $state<unknown>(undefined);
  let running = $state(false);

  async function load(): Promise<void> {
    const { entryId, id } = item;
    try {
      if (settling && entryId) {
        entry = await api.get<Arrival>(`/api/entries/${entryId}`);
      } else {
        detail = await libraryItems.detail(libraryId, id);
      }
    } catch (error) {
      failure = error;
    }
  }

  void load();

  const backdrop = $derived(
    detail?.backdropPath ? `/api/images/w780/${detail.backdropPath}` : undefined,
  );
  const poster = $derived(detail?.posterPath ? `/api/images/w154/${detail.posterPath}` : undefined);
  const present = (value: boolean | null): string =>
    value === null ? '—' : t(value ? 'web.library.present' : 'web.library.missing');
</script>

{#if failure}
  <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
{:else if entry}
  <ArrivalDetail {entry} {ondone} />
{:else if detail}
  <article class="card">
    {#if backdrop}<img class="backdrop" src={backdrop} alt="" loading="lazy" />{/if}
    <div class="head">
      {#if poster}<img class="poster" src={poster} alt="" width="92" height="138" />{/if}
      <div>
        <h2>
          {detail.title ?? detail.path.split('/').pop()}{detail.year ? ` (${detail.year})` : ''}
        </h2>
        <p class="muted">
          {[
            detail.runtime ? t('web.library.runtime', { minutes: detail.runtime }) : undefined,
            detail.genres.join(', ') || undefined,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {#if detail.tmdbId}
          <Link
            href={`https://www.themoviedb.org/${detail.kind === 'series' ? 'tv' : 'movie'}/${detail.tmdbId}`}
            target="_blank"
            rel="noreferrer">{t('web.queue.tmdb-link')}</Link
          >
        {/if}
      </div>
    </div>
    {#if detail.overview}<p>{detail.overview}</p>{:else}<p class="muted">
        {t('web.library.no-overview')}
      </p>{/if}

    <dl class="facts">
      <dt class="muted">{t('web.library.path')}</dt>
      <dd class="mono">{detail.path}</dd>
      {#if detail.file}
        <dt class="muted">{t('web.library.file')}</dt>
        <dd>
          {[detail.resolution, detail.file.video, detail.file.audio, formatSize(detail.file.size)]
            .filter(Boolean)
            .join(' · ')}
        </dd>
      {/if}
      <dt class="muted">{t('web.library.metadata')}</dt>
      <dd>
        NFO: {present(detail.nfo)} · {t('web.library.col.poster')}: {present(detail.poster)} ·
        {t('web.library.col.fanart')}: {present(detail.fanart)}
      </dd>
    </dl>
    {#if canRun(item)}
      <div>
        <button
          type="button"
          class="btn btn-primary"
          onclick={() => {
            running = true;
          }}
        >
          {t(item.state === 'rename' ? 'web.library.run.rename' : 'web.library.run.refresh')}
        </button>
      </div>
    {/if}
  </article>
  {#if running}
    <RunDialog
      {libraryId}
      items={[item]}
      mode={item.state === 'rename' ? 'rename' : 'refresh'}
      onclose={() => {
        running = false;
      }}
      {ondone}
    />
  {/if}
{:else}
  <p class="muted" role="status">{t('web.loading')}</p>
{/if}

<style>
  .backdrop {
    display: block;
    width: 100%;
    max-height: 180px;
    object-fit: cover;
    border-radius: var(--radius-sm);
  }

  .head {
    display: flex;
    gap: 16px;
  }

  .poster {
    flex: none;
    border-radius: 4px;
  }

  h2 {
    font-size: 18px;
  }

  p {
    margin: 0;
  }

  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 16px;
    margin: 0;
  }

  .facts dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
</style>
