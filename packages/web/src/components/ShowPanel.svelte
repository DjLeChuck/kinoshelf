<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import type { Show, ShowDetail } from '../lib/library-items.js';
  import Link from './Link.svelte';

  let { show, detail }: { show: Show; detail: ShowDetail | undefined } = $props();

  const poster = $derived(detail?.posterPath ? `/api/images/w154/${detail.posterPath}` : undefined);
  const backdrop = $derived(
    detail?.backdropPath ? `/api/images/w780/${detail.backdropPath}` : undefined,
  );
  const missing = $derived(detail?.missing ?? show.missing);
</script>

<article class="card">
  {#if backdrop}<img class="backdrop" src={backdrop} alt="" loading="lazy" />{/if}
  <div class="head">
    {#if poster}<img class="poster" src={poster} alt="" width="92" height="138" />{/if}
    <div>
      <h2>{show.title ?? ''}{show.year ? ` (${show.year})` : ''}</h2>
      <p class="muted">
        {[
          `${t('web.library.col.seasons')}: ${show.seasons}`,
          `${t('web.library.col.episodes')}: ${show.episodes}`,
          detail?.genres.join(', ') || undefined,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <Link href={`https://www.themoviedb.org/tv/${show.tmdbId}`} target="_blank" rel="noreferrer"
        >{t('web.queue.tmdb-link')}</Link
      >
    </div>
  </div>

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
</article>

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
  }
</style>
