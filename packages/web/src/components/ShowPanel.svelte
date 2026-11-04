<script lang="ts">
  import { imageUrl } from '../lib/arrivals.js';
  import { t } from '../lib/i18n.svelte.js';
  import type { Show, ShowDetail } from '../lib/library-items.js';
  import { rescanPath } from '../lib/paths.js';
  import RescanButton from './RescanButton.svelte';
  import WorkCard from './WorkCard.svelte';

  let {
    libraryId,
    source,
    show,
    detail,
    ondone,
  }: {
    libraryId: string;
    source: string;
    show: Show;
    detail: ShowDetail | undefined;
    /** The analysis was queued: what to tell the user. */
    ondone: (message: string) => void;
  } = $props();

  // The folder that holds every file of the show; unknown until its page is read.
  const folder = $derived(
    detail &&
      rescanPath(
        detail.seasons.flatMap(({ episodes }) =>
          episodes.flatMap(({ item }) => (item ? [item.path] : [])),
        ),
        source,
      ),
  );

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
    <div>
      <RescanButton {libraryId} path={folder} name={show.title ?? ''} {ondone} />
    </div>
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
