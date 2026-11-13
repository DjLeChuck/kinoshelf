<script lang="ts">
  import { baseName, dirName, rescanPath } from '../lib/paths.js';
  import { imageUrl, workImageUrl, type ImageKind } from '../lib/arrivals.js';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import { movieMeta, versionsSummary } from '../lib/fiche.js';
  import { pillOf } from '../lib/collections.js';
  import type { Arrival, Settled } from '../lib/arrivals.js';
  import {
    canNameVersion,
    canRun,
    isListed,
    isSettling,
    versionsToRun,
    libraryItems,
    type ItemDetail,
    type LibraryItem,
  } from '../lib/library-items.js';
  import { router } from '../lib/router.svelte.js';
  import ArrivalDetail from './ArrivalDetail.svelte';
  import CollectionDialog from './CollectionDialog.svelte';
  import ImagesDialog from './ImagesDialog.svelte';
  import MetadataMarks from './MetadataMarks.svelte';
  import RescanButton from './RescanButton.svelte';
  import RematchButton from './RematchButton.svelte';
  import RunDialog from './RunDialog.svelte';
  import VersionsSection from './VersionsSection.svelte';
  import VersionsTable from './VersionsTable.svelte';
  import WorkCard from './WorkCard.svelte';

  let {
    libraryId,
    source,
    item,
    siblings = 1,
    busy = false,
    ondone,
    onnotice,
  }: {
    libraryId: string;
    /** The library's folder: what a scan of one movie must stay inside. */
    source: string;
    item: LibraryItem;
    /** Files validated together with this one (itself included). */
    siblings?: number;
    /** A transfer is going on: renaming again what it may hold would stack the same work. */
    busy?: boolean;
    /** The file was settled (transferred or set aside): what to tell the user. */
    ondone: (message: string, settled?: Settled) => void;
    /** Something changed that the page behind should read again, with no row settled. */
    onnotice?: (message: string) => void;
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

  // The files in place when the page can say they are there, else what TMDB offers. `shown` changes
  // after an image is replaced, so the browser draws the new file under the same address.
  let shown = $state(Date.now());
  const work = $derived(`/api/libraries/${libraryId}/items/${item.id}`);
  const editable = $derived(detail?.images != null);
  const backdrop = $derived(
    detail?.images?.fanart
      ? workImageUrl(work, 'fanart', shown)
      : imageUrl('w780', detail?.backdropPath),
  );
  const poster = $derived(
    detail?.images?.poster
      ? workImageUrl(work, 'poster', shown)
      : imageUrl('w154', detail?.posterPath),
  );
  const logo = $derived(
    editable
      ? detail?.images?.logo
        ? workImageUrl(work, 'logo', shown)
        : undefined
      : imageUrl('w500', detail?.logoPath),
  );
  // Drawn from TMDB with no file in place, on a page that says what a refresh will write.
  const preview = $derived({
    poster: editable && !detail?.images?.poster && poster !== undefined,
    backdrop: editable && !detail?.images?.fanart && backdrop !== undefined,
  });
  // The image dialog, open on the tab of the image clicked.
  let imagesTab = $state<ImageKind | undefined>(undefined);
  let imagesNotice = $state<string | undefined>(undefined);
  function edit(type: ImageKind): void {
    imagesTab = type;
  }
  function imagesChanged(message: string): void {
    imagesNotice = message;
    // The files are served under the same address: a new one makes the browser draw the new files.
    shown = Date.now();
    // Which images are there changed: an added logo is no longer a box to fill.
    void libraryItems.detail(libraryId, item.id).then(
      (fresh) => {
        detail = fresh;
      },
      () => undefined,
    );
  }
  /** The collection was changed: the NFO is written again, so the page reads what it says now. */
  function collectionChanged(message: string): void {
    void libraryItems.detail(libraryId, item.id).then(
      (fresh) => {
        detail = fresh;
      },
      () => undefined,
    );
    onnotice?.(message);
  }
  const runItems = $derived(isListed(item) ? versionsToRun(item, 'refresh') : [item]);
  const missingNfo = $derived((detail?.nfoFiles ?? []).filter(({ present: there }) => !there));
  const title = $derived(
    detail
      ? `${detail.title ?? baseName(detail.path)}${detail.year ? ` (${detail.year})` : ''}`
      : '',
  );
  const effective = $derived(detail?.collectionChoice?.effective ?? null);
  // The collection dialog, opened from the Collection fact; its button gets the focus back when it
  // closes, whatever the fact now says.
  let collecting = $state(false);
  let collectionButton = $state<HTMLButtonElement | undefined>(undefined);
  const marks = $derived(
    detail
      ? [
          {
            label: 'NFO',
            value: detail.nfo,
            title: detail.nfoFiles.map((file) => baseName(file.path)).join(', '),
          },
          {
            label: t('web.library.col.poster'),
            value: detail.poster,
            unavailable: detail.unavailable.includes('poster'),
          },
          {
            label: t('web.library.col.fanart'),
            value: detail.fanart,
            unavailable: detail.unavailable.includes('fanart'),
          },
          {
            label: t('web.library.col.logo'),
            value: detail.logo,
            unavailable: detail.unavailable.includes('logo'),
          },
        ]
      : [],
  );
</script>

{#if failure}
  <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
{:else if entry}
  <ArrivalDetail {entry} {siblings} {ondone} />
{:else if detail}
  <WorkCard
    {title}
    meta={movieMeta(detail.runtime, detail.genres, t)}
    tmdbUrl={detail.tmdbId
      ? `https://www.themoviedb.org/${detail.kind === 'series' ? 'tv' : 'movie'}/${detail.tmdbId}`
      : undefined}
    {poster}
    {backdrop}
    {logo}
    {preview}
    onedit={editable ? edit : undefined}
  >
    {#if imagesNotice}<p class="alert" role="status">{imagesNotice}</p>{/if}
    {#if detail.overview}<p>{detail.overview}</p>{:else}<p class="muted">
        {t('web.library.no-overview')}
      </p>{/if}

    <dl class="facts">
      {#if detail.collectionChoice}
        <dt class="muted">{t('web.collection.fact')}</dt>
        <dd class="collection-fact">
          <span class="info">
            {#if effective === null}
              {t('web.collection.fact.none')}
            {:else}
              {@const pill = pillOf(effective)}
              <span>{effective.name}</span>
              <span class="chip chip-{pill.kind}">{pill.text ?? t('web.collection.custom')}</span>
              <button
                type="button"
                class="link show"
                onclick={() => {
                  router.setQuery({ collection: effective.key });
                }}>{t('web.collection.fact.show')}</button
              >
            {/if}
          </span>
          <button
            type="button"
            class="btn small"
            bind:this={collectionButton}
            aria-label={effective === null
              ? t('web.collection.fact.set.label', { title })
              : t('web.collection.fact.edit.label', { name: effective.name })}
            onclick={() => {
              collecting = true;
            }}
          >
            {t(effective === null ? 'web.collection.fact.set' : 'web.collection.fact.edit')}
          </button>
        </dd>
      {/if}
      <dt class="muted">{t('web.library.path')}</dt>
      <dd class="mono">{dirName(detail.path)}</dd>
      <dt class="muted">{t('web.library.metadata')}</dt>
      <dd><MetadataMarks {marks} /></dd>
    </dl>
    {#if item.kind === 'movie' && detail.versions.length > 0}
      <VersionsSection summary={versionsSummary(detail.versions, locale.value)}>
        <VersionsTable versions={detail.versions} />
      </VersionsSection>
    {/if}
    {#if missingNfo.length > 0 && canRun(item)}
      <div>
        <button
          type="button"
          class="btn"
          disabled={busy}
          onclick={() => {
            running = 'refresh';
          }}
        >
          {t('web.library.nfo.generate')}
        </button>
      </div>
    {/if}
    {#if canRun(item) && !(item.state === 'incomplete' && missingNfo.length > 0)}
      <div>
        <button
          type="button"
          class="btn btn-primary"
          disabled={busy}
          onclick={() => {
            running = item.state === 'rename' ? 'rename' : 'refresh';
          }}
        >
          {t(item.state === 'rename' ? 'web.library.run.rename' : 'web.library.run.refresh')}
        </button>
      </div>
    {/if}
    {#if item.kind === 'movie'}
      <div>
        <RescanButton
          {libraryId}
          path={rescanPath([item.path], source)}
          name={item.title ?? baseName(item.path)}
          {ondone}
        />
        <RematchButton
          {libraryId}
          path={rescanPath([item.path], source)}
          name={item.title ?? baseName(item.path)}
          kind="movie"
          year={item.year}
          {ondone}
        />
      </div>
    {/if}
    {#if canNameVersion(item)}
      <div>
        <button
          type="button"
          class="btn"
          disabled={busy}
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
  {#if collecting && detail.collectionChoice}
    <CollectionDialog
      {libraryId}
      items={[item.id]}
      {title}
      detail={detail.collectionChoice}
      onclose={() => {
        collecting = false;
        collectionButton?.focus();
      }}
      ondone={collectionChanged}
    />
  {/if}
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
  {#if running}
    <RunDialog
      {libraryId}
      items={running === 'refresh' ? runItems : [item]}
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

  .collection-fact {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px 12px;
  }

  .info {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 8px;
    min-width: 0;
  }

  /* Compact: the button sits at the end of the line, not a block of its own. */
  .small {
    flex: none;
    min-height: 36px;
    padding: 0 12px;
    font-size: 13px;
  }

  .show {
    min-height: 0;
    color: var(--accent-text);
    text-decoration: underline;
  }
</style>
