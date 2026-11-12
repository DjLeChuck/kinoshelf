<script lang="ts">
  import { workImageUrl } from '../lib/arrivals.js';
  import { episodeMeta, versionsSummary } from '../lib/fiche.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import {
    episodeLabel,
    libraryItems,
    nfoOf,
    thumbOf,
    type ItemDetail,
    type ShowEpisode,
    type Version,
  } from '../lib/library-items.js';
  import { messageOf } from '../lib/errors.js';
  import { dirName } from '../lib/paths.js';
  import { EPISODE_KINDS } from '../lib/images.js';
  import ImagesDialog from './ImagesDialog.svelte';
  import MetadataMarks from './MetadataMarks.svelte';
  import VersionsSection from './VersionsSection.svelte';
  import VersionsTable from './VersionsTable.svelte';
  import WorkCard from './WorkCard.svelte';

  let {
    libraryId,
    tmdbId,
    showTitle,
    episode,
    poster,
    busy = false,
    onimage,
  }: {
    libraryId: string;
    tmdbId: number;
    showTitle: string;
    episode: ShowEpisode;
    /** The series' poster: the small one beside the title. */
    poster?: string | undefined;
    busy?: boolean;
    /** The image was changed: the panel stays on the episode, the page only reads its lists again. */
    onimage: (message: string) => void;
  } = $props();

  // The parent keys this panel on the episode, so the files read here once are right for its life.
  let details = $state<Readonly<Record<string, ItemDetail>>>({});
  let failure = $state<unknown>(undefined);

  /* svelte-ignore state_referenced_locally */
  const files = episode.versions;
  void Promise.all(
    files.map(async (file) => [file.id, await libraryItems.detail(libraryId, file.id)] as const),
  ).then(
    (read) => {
      details = Object.fromEntries(read);
    },
    (error: unknown) => {
      failure = error;
    },
  );

  // One column per file; what `ffprobe` read of it comes with its page, so a column fills in late.
  const versions = $derived<Version[]>(
    files.map((file) => ({
      id: file.id,
      path: file.path,
      state: file.state,
      resolution: file.resolution,
      nfo: file.nfo,
      entryId: file.entryId,
      file: details[file.id]?.file ?? null,
    })),
  );

  // The files are read once: after a change every version has the picture, so the panel says so.
  let imageChanged = $state(false);
  const nfo = $derived(nfoOf(files));
  const thumb = $derived(imageChanged ? true : thumbOf(files));
  // The picture is the episode's, one for all its versions: it is changed from here, not per file.
  const imagesBase = $derived(
    `/api/libraries/${libraryId}/shows/${String(tmdbId)}/seasons/${String(episode.season)}/episodes/${String(episode.episode)}`,
  );
  const canEdit = $derived(
    files.some((file) => file.state === 'ok' || file.state === 'incomplete'),
  );
  const hasImage = $derived(imageChanged || files.some((file) => file.thumb === true));
  let stamp = $state(Date.now());
  let editing = $state(false);
  let imageFailed = $state(false);
  const showImage = $derived(hasImage && !imageFailed);
  // The season's folder: where the files of the episode lie.
  const folder = $derived(files[0] ? dirName(files[0].path) : undefined);
  const marks = $derived([
    { label: 'NFO', value: nfo },
    { label: t('web.library.col.thumb'), value: thumb },
  ]);
  const label = $derived(`${showTitle} · ${episodeLabel(episode.season, episode.episode)}`);
</script>

{#snippet still()}
  {#if showImage}
    {#if canEdit}
      <button
        type="button"
        class="zone fill"
        disabled={busy}
        aria-label={t('web.images.change-thumb')}
        onclick={() => (editing = true)}
      >
        <img
          src={workImageUrl(imagesBase, 'thumb', stamp)}
          alt=""
          onerror={() => {
            imageFailed = true;
          }}
        />
        <span class="veil" aria-hidden="true"></span>
        <span class="pill" aria-hidden="true">{t('web.images.change-thumb')}</span>
      </button>
    {:else}
      <img
        class="fill"
        src={workImageUrl(imagesBase, 'thumb', stamp)}
        alt=""
        onerror={() => {
          imageFailed = true;
        }}
      />
    {/if}
  {:else}
    <button type="button" class="zone fill add" disabled={busy} onclick={() => (editing = true)}>
      + {t('web.images.add-thumb')}
    </button>
  {/if}
{/snippet}

<WorkCard
  kicker={label}
  title={episode.title ?? episodeLabel(episode.season, episode.episode)}
  meta={episodeMeta(episode.airDate, episode.runtime, locale.value, t)}
  tmdbUrl={`https://www.themoviedb.org/tv/${String(tmdbId)}/season/${String(episode.season)}/episode/${String(episode.episode)}`}
  {poster}
  still={showImage || canEdit ? still : undefined}
>
  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {/if}
  {#if episode.overview}<p>{episode.overview}</p>{:else}<p class="muted">
      {t('web.library.no-overview')}
    </p>{/if}

  <dl class="facts">
    {#if folder}
      <dt class="muted">{t('web.library.path')}</dt>
      <dd class="mono">{folder}</dd>
    {/if}
    <dt class="muted">{t('web.library.metadata')}</dt>
    <dd><MetadataMarks {marks} /></dd>
  </dl>

  {#if versions.length > 0}
    <VersionsSection summary={versionsSummary(versions, locale.value)}>
      <VersionsTable {versions} />
    </VersionsSection>
  {/if}

  <!-- No buttons: the analysis and the matching are the series' or the season's, not an episode's. -->
  <p class="muted hint">{t('web.library.episode.actions-hint')}</p>
</WorkCard>

{#if editing}
  <ImagesDialog
    base={imagesBase}
    initial="thumb"
    kinds={EPISODE_KINDS}
    heading={`${showTitle} — ${episodeLabel(episode.season, episode.episode)}`}
    onclose={() => {
      editing = false;
    }}
    ondone={(message: string) => {
      imageChanged = true;
      imageFailed = false;
      stamp = Date.now();
      onimage(message);
    }}
  />
{/if}

<style>
  p {
    margin: 0;
  }

  .hint {
    font-size: 12.5px;
  }

  .fill {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .zone {
    padding: 0;
    border: 0;
    background: none;
    color: #fff;
    cursor: pointer;
  }

  .zone img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* The same overlay as the banner of a movie or a show: a light veil and a pill at the top right. */
  .veil {
    position: absolute;
    inset: 0;
    background: rgb(10 12 16 / 0.35);
    opacity: 0;
  }

  .pill {
    position: absolute;
    top: 10px;
    right: 10px;
    min-height: 44px;
    display: flex;
    align-items: center;
    padding: 0 14px;
    border-radius: 22px;
    background: rgb(20 22 27 / 0.88);
    font-weight: 600;
    font-size: 14px;
    opacity: 0;
  }

  .zone:hover .veil,
  .zone:focus-visible .veil,
  .zone:hover .pill,
  .zone:focus-visible .pill {
    opacity: 1;
  }

  .zone.add {
    border: 2px dashed var(--border-strong);
    color: var(--muted);
    font-weight: 600;
    font-size: 14px;
  }
</style>
