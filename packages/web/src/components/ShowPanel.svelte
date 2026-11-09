<script lang="ts">
  import { imageUrl, workImageUrl, type ImageKind } from '../lib/arrivals.js';
  import { t } from '../lib/i18n.svelte.js';
  import { libraryItems, showStatusKey, type Show, type ShowDetail } from '../lib/library-items.js';
  import { rescanPath } from '../lib/paths.js';
  import CoverageMatrix from './CoverageMatrix.svelte';
  import ImagesDialog from './ImagesDialog.svelte';
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
          episodes.flatMap(({ versions }) => versions.map((version) => version.path)),
        ),
        source,
      ),
  );

  // The files in place when the page can say they are there, else what TMDB offers.
  let shown = $state(Date.now());
  const work = $derived(`/api/libraries/${libraryId}/shows/${show.tmdbId}`);
  // Read again after an image is replaced; until then, what the page said.
  let changed = $state<ShowDetail['images'] | undefined>(undefined);
  const images = $derived(changed === undefined ? detail?.images : changed);
  const editable = $derived(images != null);
  const poster = $derived(
    images?.poster ? workImageUrl(work, 'poster', shown) : imageUrl('w154', detail?.posterPath),
  );
  const backdrop = $derived(
    images?.fanart ? workImageUrl(work, 'fanart', shown) : imageUrl('w780', detail?.backdropPath),
  );
  const logo = $derived(
    editable
      ? images?.logo
        ? workImageUrl(work, 'logo', shown)
        : undefined
      : imageUrl('w500', detail?.logoPath),
  );
  // The image dialog, open on the tab of the image clicked.
  let imagesTab = $state<ImageKind | undefined>(undefined);
  let imagesNotice = $state<string | undefined>(undefined);
  function edit(type: ImageKind): void {
    imagesTab = type;
  }
  function imagesChanged(message: string): void {
    imagesNotice = message;
    shown = Date.now();
    void libraryItems.show(libraryId, show.tmdbId).then(
      (fresh) => {
        changed = fresh.images;
      },
      () => undefined,
    );
  }
  const statusKey = $derived(detail?.status ? showStatusKey(detail.status) : undefined);
  const missing = $derived(detail?.missing ?? show.missing);
</script>

<WorkCard
  title={`${show.title ?? ''}${show.year ? ` (${show.year})` : ''}`}
  meta={[
    `${t('web.library.col.seasons')}: ${show.seasons}`,
    `${t('web.library.col.episodes')}: ${show.episodes}`,
    show.versions.length > 1
      ? t('web.library.versions.count', { count: show.versions.length })
      : undefined,
    detail?.genres.join(', ') || undefined,
  ]
    .filter(Boolean)
    .join(' · ')}
  tmdbUrl={`https://www.themoviedb.org/tv/${show.tmdbId}`}
  {poster}
  {backdrop}
  {logo}
  onedit={editable ? edit : undefined}
>
  {#if detail === undefined}
    <p class="muted" role="status">{t('web.loading')}</p>
  {:else}
    {#if imagesNotice}<p class="alert" role="status">{imagesNotice}</p>{/if}
    {#if detail.overview}<p>{detail.overview}</p>{:else}<p class="muted">
        {t('web.library.no-overview')}
      </p>{/if}
    <dl class="facts">
      {#if detail.status}
        <dt class="muted">{t('web.library.show.status')}</dt>
        <dd>{statusKey ? t(statusKey) : detail.status}</dd>
      {/if}
      <dt class="muted">{t('web.library.show.missing')}</dt>
      <dd>{missing === null || missing === 0 ? t('web.library.show.none-missing') : missing}</dd>
    </dl>
    {#if !detail.determined}
      <p class="alert" role="status">{t('web.library.shows.undetermined')}</p>
    {/if}
    {#if show.versions.length > 1}<CoverageMatrix {detail} />{/if}
    <div>
      <RescanButton {libraryId} path={folder} name={show.title ?? ''} {ondone} />
    </div>
  {/if}
</WorkCard>
{#if imagesTab}
  <ImagesDialog
    base={work}
    initial={imagesTab}
    onclose={() => {
      imagesTab = undefined;
    }}
    ondone={imagesChanged}
  />
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
  }
</style>
