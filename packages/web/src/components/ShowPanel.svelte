<script lang="ts">
  import { imageUrl, workImageUrl, type ImageKind } from '../lib/arrivals.js';
  import { t } from '../lib/i18n.svelte.js';
  import { missingOfKnown, showMeta } from '../lib/fiche.js';
  import { libraryItems, showStatusKey, type Show, type ShowDetail } from '../lib/library-items.js';
  import { rescanPath } from '../lib/paths.js';
  import CoverageMatrix from './CoverageMatrix.svelte';
  import ImagesDialog from './ImagesDialog.svelte';
  import MetadataMarks from './MetadataMarks.svelte';
  import VersionsSection from './VersionsSection.svelte';
  import RescanButton from './RescanButton.svelte';
  import RematchButton from './RematchButton.svelte';
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
  const preview = $derived({
    poster: images != null && !images.poster && poster !== undefined,
    backdrop: images != null && !images.fanart && backdrop !== undefined,
  });
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
  // The show's own files, as the list reads them from the disk; a dash for what TMDB has none of.
  const marks = $derived([
    { label: 'NFO', value: show.nfo },
    {
      label: t('web.library.col.poster'),
      value: show.poster,
      unavailable: show.unavailable.includes('poster'),
    },
    {
      label: t('web.library.col.fanart'),
      value: show.fanart,
      unavailable: show.unavailable.includes('fanart'),
    },
    {
      label: t('web.library.col.logo'),
      value: show.logo,
      unavailable: show.unavailable.includes('logo'),
    },
  ]);
</script>

<WorkCard
  title={`${show.title ?? ''}${show.year ? ` (${show.year})` : ''}`}
  meta={showMeta(show.seasons, show.episodes, detail?.genres ?? [], t)}
  tmdbUrl={`https://www.themoviedb.org/tv/${show.tmdbId}`}
  {poster}
  {backdrop}
  {logo}
  {preview}
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
      <dd>
        {missing === null || missing === 0
          ? t('web.library.show.none-missing')
          : missingOfKnown(missing, detail.known, t)}
      </dd>
      {#if folder}
        <dt class="muted">{t('web.library.path')}</dt>
        <dd class="mono">{folder}</dd>
      {/if}
      <dt class="muted">{t('web.library.metadata')}</dt>
      <dd><MetadataMarks {marks} /></dd>
    </dl>
    {#if !detail.determined}
      <p class="alert" role="status">{t('web.library.shows.undetermined')}</p>
    {/if}
    <VersionsSection summary={[String(show.versions.length)]}>
      <CoverageMatrix {detail} />
    </VersionsSection>
    <div>
      <RescanButton {libraryId} path={folder} name={show.title ?? ''} {ondone} />
      <RematchButton
        {libraryId}
        path={folder}
        name={show.title ?? ''}
        kind="series"
        year={show.year}
        {ondone}
      />
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
</style>
