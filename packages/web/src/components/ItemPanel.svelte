<script lang="ts">
  import { baseName, dirName, rescanPath } from '../lib/paths.js';
  import { imageUrl, workImageUrl, type ImageKind } from '../lib/arrivals.js';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { formatBytes } from '@kinoshelf/i18n';
  import { locale, t } from '../lib/i18n.svelte.js';
  import { languageName, totalSize, HDR_LABEL } from '../lib/versions.js';
  import type { Arrival } from '../lib/arrivals.js';
  import {
    canNameVersion,
    canRun,
    isListed,
    isSettling,
    versionsToRun,
    type Version,
    libraryItems,
    type ItemDetail,
    type LibraryItem,
  } from '../lib/library-items.js';
  import ArrivalDetail from './ArrivalDetail.svelte';
  import ImagesDialog from './ImagesDialog.svelte';
  import RescanButton from './RescanButton.svelte';
  import RunDialog from './RunDialog.svelte';
  import WorkCard from './WorkCard.svelte';

  let {
    libraryId,
    source,
    item,
    siblings = 1,
    busy = false,
    ondone,
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
  const runItems = $derived(isListed(item) ? versionsToRun(item, 'refresh') : [item]);
  const missingNfo = $derived((detail?.nfoFiles ?? []).filter(({ present: there }) => !there));
  const size = $derived(totalSize((detail?.versions ?? []).map(({ file }) => file)));
  const compared = $derived(item.kind === 'movie' && (detail?.versions.length ?? 0) > 1);
  type Row = {
    readonly key: 'hdr' | 'video' | 'audio' | 'subtitles' | 'size' | 'file';
    readonly read: (version: Version) => string;
  };
  const dash = '—';
  const names = (codes: readonly string[]): string =>
    codes.map((code) => languageName(code, locale.value)).join(', ');
  // What the "Compare" table lists, one line per fact; a file not read yet has none to give.
  const compareRows: readonly Row[] = [
    {
      key: 'hdr',
      read: (v) =>
        v.file === null ? dash : v.file.hdr ? HDR_LABEL[v.file.hdr] : t('web.library.compare.sdr'),
    },
    { key: 'video', read: (v) => v.file?.video ?? dash },
    {
      key: 'audio',
      read: (v) =>
        [v.file?.audio, names(v.file?.audioLanguages ?? [])].filter(Boolean).join(' · ') || dash,
    },
    { key: 'subtitles', read: (v) => names(v.file?.subtitleLanguages ?? []) || dash },
    { key: 'size', read: (v) => (v.file ? formatBytes(v.file.size) : dash) },
    { key: 'file', read: (v) => baseName(v.path) },
  ];
  const present = (value: boolean | null): string =>
    value === null ? '—' : t(value ? 'web.library.present' : 'web.library.missing');
</script>

{#if failure}
  <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
{:else if entry}
  <ArrivalDetail {entry} {siblings} {ondone} />
{:else if detail}
  <WorkCard
    title={`${detail.title ?? baseName(detail.path)}${detail.year ? ` (${detail.year})` : ''}`}
    meta={[
      detail.runtime ? t('web.library.runtime', { minutes: detail.runtime }) : undefined,
      detail.genres.join(', ') || undefined,
      size === null
        ? undefined
        : t('web.library.versions.summary', {
            count: detail.versions.length,
            size: formatBytes(size),
          }),
    ]
      .filter(Boolean)
      .join(' · ')}
    tmdbUrl={detail.tmdbId
      ? `https://www.themoviedb.org/${detail.kind === 'series' ? 'tv' : 'movie'}/${detail.tmdbId}`
      : undefined}
    {poster}
    {backdrop}
    {logo}
    onedit={editable ? edit : undefined}
  >
    {#if imagesNotice}<p class="alert" role="status">{imagesNotice}</p>{/if}
    {#if detail.overview}<p>{detail.overview}</p>{:else}<p class="muted">
        {t('web.library.no-overview')}
      </p>{/if}

    <dl class="facts">
      <dt class="muted">{t('web.library.path')}</dt>
      <dd class="mono">{compared ? dirName(detail.path) : detail.path}</dd>
      {#if detail.file}
        <dt class="muted">{t('web.library.file')}</dt>
        <dd>
          {[detail.resolution, detail.file.video, detail.file.audio, formatBytes(detail.file.size)]
            .filter(Boolean)
            .join(' · ')}
        </dd>
      {/if}
      <dt class="muted">{t('web.library.metadata')}</dt>
      <dd class="marks">
        {#each [['NFO', detail.nfo], [t('web.library.col.poster'), detail.poster], [t('web.library.col.fanart'), detail.fanart], [t('web.library.col.logo'), detail.logo]] as const as [label, value] (label)}
          <span>
            <span aria-hidden="true" class:ok={value === true} class:ko={value === false}
              >{value === null ? '—' : value ? '✓' : '✗'}</span
            >
            {label}<span class="sr-only">: {present(value)}</span>
          </span>
        {/each}
      </dd>
    </dl>
    {#if compared}
      <section aria-labelledby="compare">
        <h3 id="compare">{t('web.library.compare.title')}</h3>
        <div class="scroll">
          <table class="compare">
            <thead>
              <tr>
                <th scope="col"></th>
                {#each detail.versions as version (version.id)}
                  <th scope="col">{version.resolution ?? t('web.library.version.unknown')}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each compareRows as row (row.key)}
                <tr>
                  <th scope="row">{t(`web.library.compare.${row.key}`)}</th>
                  {#each detail.versions as version (version.id)}
                    <td class:mono={row.key === 'file'}>{row.read(version)}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}
    <section aria-labelledby="nfo">
      <h3 id="nfo">{t('web.library.nfo.title')}</h3>
      {#if detail.nfoFiles.length === 0}
        <p class="muted">{t('web.library.nfo.none')}</p>
      {:else}
        <ul class="nfos">
          {#each detail.nfoFiles as file (file.path)}
            <li>
              <span aria-hidden="true">{file.present ? '✓' : '✗'}</span>
              <span class="mono">{baseName(file.path)}</span>
              <span class="sr-only">: {present(file.present)}</span>
            </li>
          {/each}
        </ul>
        {#if missingNfo.length > 0 && canRun(item)}
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
        {/if}
      {/if}
    </section>
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

  h3 {
    margin: 0 0 6px;
    font-size: 14px;
  }

  .scroll {
    overflow-x: auto;
  }

  .compare {
    width: max-content;
    min-width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }

  .compare th,
  .compare td {
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
    overflow-wrap: anywhere;
  }

  /* The versions make the columns, so there is no telling how many: the table scrolls sideways
     rather than crushing the names of the lines, which stay in view. */
  .compare td,
  .compare th[scope='col'] {
    min-width: 64px;
    /* A long file name wraps in its column instead of widening every one of them. */
    max-width: 92px;
  }

  /* The corner is held with the names of the lines, so a header scrolling sideways never slides over it. */
  .compare th[scope='row'],
  .compare thead th:first-child {
    position: sticky;
    left: 0;
    z-index: 1;
    box-shadow: 1px 0 0 var(--border);
    background: var(--surface);
  }

  .compare th[scope='row'] {
    color: var(--muted);
    font-weight: 600;
    white-space: nowrap;
  }

  .nfos {
    margin: 6px 0;
    padding: 0;
    list-style: none;
  }

  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 16px;
    margin: 0;
  }

  .marks {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
  }

  .ok {
    color: var(--ok);
  }

  .ko {
    color: var(--danger);
  }

  .facts dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
</style>
