<script lang="ts">
  import { imageUrl } from '../lib/arrivals.js';
  import { t } from '../lib/i18n.svelte.js';
  import type { Show, ShowDetail } from '../lib/library-items.js';
  import WorkCard from './WorkCard.svelte';

  let { show, detail }: { show: Show; detail: ShowDetail | undefined } = $props();

  const poster = $derived(imageUrl('w154', detail?.posterPath));
  const backdrop = $derived(imageUrl('w780', detail?.backdropPath));
  const missing = $derived(detail?.missing ?? show.missing);
</script>

<WorkCard
  title={`${show.title ?? ''}${show.year ? ` (${show.year})` : ''}`}
  meta={[
    `${t('web.library.col.seasons')}: ${show.seasons}`,
    `${t('web.library.col.episodes')}: ${show.episodes}`,
    detail?.genres.join(', ') || undefined,
  ]
    .filter(Boolean)
    .join(' · ')}
  tmdbUrl={`https://www.themoviedb.org/tv/${show.tmdbId}`}
  {poster}
  {backdrop}
>
  {#if detail === undefined}
    <p class="muted" role="status">{t('web.loading')}</p>
  {:else}
    {#if detail.overview}<p>{detail.overview}</p>{:else}<p class="muted">
        {t('web.library.no-overview')}
      </p>{/if}
    <dl class="facts">
      {#if detail.status}
        <dt class="muted">{t('web.library.show.status')}</dt>
        <dd>{detail.status}</dd>
      {/if}
      <dt class="muted">{t('web.library.show.missing')}</dt>
      <dd>{missing === null || missing === 0 ? t('web.library.show.none-missing') : missing}</dd>
    </dl>
    {#if !detail.determined}
      <p class="alert" role="status">{t('web.library.shows.undetermined')}</p>
    {/if}
  {/if}
</WorkCard>

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
  }
</style>
