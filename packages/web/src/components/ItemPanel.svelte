<script lang="ts">
  import { baseName } from '../lib/paths.js';
  import { imageUrl } from '../lib/arrivals.js';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { formatBytes } from '@kinoshelf/i18n';
  import { t } from '../lib/i18n.svelte.js';
  import type { Arrival } from '../lib/arrivals.js';
  import {
    canNameVersion,
    canRun,
    isSettling,
    libraryItems,
    type ItemDetail,
    type LibraryItem,
  } from '../lib/library-items.js';
  import ArrivalDetail from './ArrivalDetail.svelte';
  import RunDialog from './RunDialog.svelte';
  import WorkCard from './WorkCard.svelte';

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
  const settling = isSettling(item);
  let detail = $state<ItemDetail | undefined>(undefined);
  let entry = $state<Arrival | undefined>(undefined);
  let failure = $state<unknown>(undefined);
  let running = $state<'rename' | 'refresh' | 'version' | undefined>(undefined);

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

  const backdrop = $derived(imageUrl('w780', detail?.backdropPath));
  const poster = $derived(imageUrl('w154', detail?.posterPath));
  const present = (value: boolean | null): string =>
    value === null ? '—' : t(value ? 'web.library.present' : 'web.library.missing');
</script>

{#if failure}
  <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
{:else if entry}
  <ArrivalDetail {entry} {ondone} />
{:else if detail}
  <WorkCard
    title={`${detail.title ?? baseName(detail.path)}${detail.year ? ` (${detail.year})` : ''}`}
    meta={[
      detail.runtime ? t('web.library.runtime', { minutes: detail.runtime }) : undefined,
      detail.genres.join(', ') || undefined,
    ]
      .filter(Boolean)
      .join(' · ')}
    tmdbUrl={detail.tmdbId
      ? `https://www.themoviedb.org/${detail.kind === 'series' ? 'tv' : 'movie'}/${detail.tmdbId}`
      : undefined}
    {poster}
    {backdrop}
  >
    {#if detail.overview}<p>{detail.overview}</p>{:else}<p class="muted">
        {t('web.library.no-overview')}
      </p>{/if}

    <dl class="facts">
      <dt class="muted">{t('web.library.path')}</dt>
      <dd class="mono">{detail.path}</dd>
      {#if detail.file}
        <dt class="muted">{t('web.library.file')}</dt>
        <dd>
          {[detail.resolution, detail.file.video, detail.file.audio, formatBytes(detail.file.size)]
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
            running = item.state === 'rename' ? 'rename' : 'refresh';
          }}
        >
          {t(item.state === 'rename' ? 'web.library.run.rename' : 'web.library.run.refresh')}
        </button>
      </div>
    {/if}
    {#if canNameVersion(item)}
      <div>
        <button
          type="button"
          class="btn"
          onclick={() => {
            running = 'version';
          }}
        >
          {t('web.library.run.version')}
        </button>
        <p class="muted">{t('web.library.run.version.hint')}</p>
      </div>
    {/if}
  </WorkCard>
  {#if running}
    <RunDialog
      {libraryId}
      items={[item]}
      mode={running}
      onclose={() => {
        running = undefined;
      }}
      {ondone}
    />
  {/if}
{:else}
  <p class="muted" role="status">{t('web.loading')}</p>
{/if}

<style>
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
