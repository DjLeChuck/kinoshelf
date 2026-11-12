<script lang="ts">
  import { formatBytes } from '@kinoshelf/i18n';
  import { workImageUrl } from '../lib/arrivals.js';
  import { messageOf } from '../lib/errors.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import {
    canNameVersion,
    canRun,
    episodeLabel,
    libraryItems,
    nfoOf,
    thumbOf,
    type Coverage,
    type ItemDetail,
    type LibraryItem,
    type ShowEpisode,
  } from '../lib/library-items.js';
  import { baseName } from '../lib/paths.js';
  import { codecLine, languageShort, slotsOf, versionLabel, type Slot } from '../lib/versions.js';
  import { EPISODE_KINDS } from '../lib/images.js';
  import ImagesDialog from './ImagesDialog.svelte';
  import RunDialog from './RunDialog.svelte';
  import WorkCard from './WorkCard.svelte';

  let {
    libraryId,
    tmdbId,
    showTitle,
    episode,
    coverage,
    busy = false,
    ondone,
    onimage,
  }: {
    libraryId: string;
    tmdbId: number;
    showTitle: string;
    episode: ShowEpisode;
    /** The versions of the show, as its season lists them. */
    coverage: readonly Coverage[];
    busy?: boolean;
    /** A batch was queued: what to tell the user. */
    ondone: (message: string) => void;
    /** The image was changed: the panel stays on the episode, the page only reads its lists again. */
    onimage: (message: string) => void;
  } = $props();

  // The parent keys this panel on the episode, so the files read here once are right for its life.
  let details = $state<Readonly<Record<string, ItemDetail>>>({});
  let failure = $state<unknown>(undefined);
  let running = $state<
    { mode: 'rename' | 'refresh' | 'version'; items: readonly LibraryItem[] } | undefined
  >(undefined);

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

  const slots = $derived(slotsOf(coverage, files));
  // The files are read once: after a change every version has the picture, so the panel says so.
  let imageChanged = $state(false);
  const nfo = $derived(nfoOf(files));
  // The files that lack their NFO: one button writes them all, whatever the version.
  const lackingNfo = $derived(files.filter((file) => file.nfo === false));
  const thumb = $derived(imageChanged ? true : thumbOf(files));
  // The picture is the episode's, one for all its versions: it is changed from here, not per file.
  const imagesBase = $derived(
    `/api/libraries/${libraryId}/shows/${String(tmdbId)}/seasons/${String(episode.season)}/episodes/${String(episode.episode)}`,
  );
  const hasImage = $derived(imageChanged || files.some((file) => file.thumb === true));
  let stamp = $state(Date.now());
  let editing = $state(false);
  let imageFailed = $state(false);
  const statusChip = {
    complete: 'chip-ok',
    'nfo-missing': 'chip-warn',
    absent: 'chip-neutral',
  } as const;

  const specs = (detail: ItemDetail | undefined): string => {
    const file = detail?.file ?? null;
    if (file === null) {
      return '';
    }
    return [
      codecLine(file),
      file.audioLanguages.map(languageShort).join(' '),
      file.subtitleLanguages.length
        ? t('web.library.version.subtitles', {
            languages: file.subtitleLanguages.map(languageShort).join(' '),
          })
        : '',
      formatBytes(file.size, locale.value),
    ]
      .filter(Boolean)
      .join(' · ');
  };

  const label = (slot: Slot): string =>
    versionLabel(slot.resolution, slot.file ? (details[slot.file.id]?.file ?? null) : null).join(
      ' ',
    ) || t('web.library.version.unknown');
</script>

<WorkCard
  title={`${showTitle} · ${episodeLabel(episode.season, episode.episode)}`}
  meta={[episode.title, episode.airDate].filter(Boolean).join(' · ')}
>
  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {/if}
  {#if thumb !== null}
    <section aria-labelledby="thumb">
      <h3 id="thumb">{t('web.library.episode.thumb')}</h3>
      {#if hasImage && !imageFailed}
        <img
          class="still"
          src={workImageUrl(imagesBase, 'thumb', stamp)}
          alt=""
          onerror={() => {
            imageFailed = true;
          }}
        />
      {/if}
      <p class="state">
        <span class={thumb ? 'ok' : 'missing'} aria-hidden="true">{thumb ? '✓' : '✗'}</span>
        {t(thumb ? 'web.library.present' : 'web.library.missing')}
      </p>
      {#if files.some((file) => file.state === 'ok' || file.state === 'incomplete')}
        <button type="button" class="btn" disabled={busy} onclick={() => (editing = true)}>
          {t(hasImage ? 'web.images.change-thumb' : 'web.images.add-thumb')}
        </button>
      {/if}
    </section>
  {/if}

  <!-- One NFO status for the episode: each version has its own file, written from the same data. -->
  {#if nfo !== null}
    <section aria-labelledby="nfo">
      <h3 id="nfo">{t('web.library.nfo.title')}</h3>
      <p class="state">
        <span class={nfo ? 'ok' : 'missing'} aria-hidden="true">{nfo ? '✓' : '✗'}</span>
        {t(nfo ? 'web.library.present' : 'web.library.missing')}
      </p>
      <!-- With several versions, which of them lack theirs. -->
      {#if files.length > 1}
        {#each lackingNfo as file (file.id)}
          {#each (details[file.id]?.nfoFiles ?? []).filter((known) => !known.present) as lacking (lacking.path)}
            <p class="muted mono lacking">{baseName(lacking.path)}</p>
          {/each}
        {/each}
      {/if}
      {#if lackingNfo.some((file) => canRun(file))}
        <button
          type="button"
          class="btn"
          disabled={busy}
          onclick={() => {
            running = { mode: 'refresh', items: lackingNfo.filter((file) => canRun(file)) };
          }}
        >
          {t('web.library.nfo.generate')}
        </button>
      {/if}
    </section>
  {/if}

  <section aria-labelledby="versions">
    <h3 id="versions">{t('web.library.episode.versions')}</h3>
    <ul class="cards">
      {#each slots as slot (slot.resolution ?? '')}
        {@const file = slot.file}
        {@const detail = file ? details[file.id] : undefined}
        <li class="version" class:absent={slot.status === 'absent'}>
          <div class="head">
            <strong>{label(slot)}</strong>
            <span class="chip {statusChip[slot.status]}"
              >{t(`web.library.version.status.${slot.status}`)}</span
            >
          </div>
          {#if file === undefined}
            <p class="muted">{t('web.library.episode.no-file')}</p>
          {:else}
            {#if specs(detail)}<p class="muted">{specs(detail)}</p>{/if}
            <p class="mono">{baseName(file.path)}</p>
            <div class="actions">
              {#if canRun(file) && file.state === 'rename'}
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled={busy}
                  onclick={() => {
                    running = { mode: 'rename', items: [file] };
                  }}
                >
                  {t('web.library.run.rename')}
                </button>
              {/if}
              {#if canNameVersion(file)}
                <button
                  type="button"
                  class="btn"
                  disabled={busy}
                  onclick={() => {
                    running = { mode: 'version', items: [file] };
                  }}
                >
                  {t('web.library.run.version')}
                </button>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
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

{#if running}
  <RunDialog
    {libraryId}
    items={running.items}
    mode={running.mode}
    onclose={() => {
      running = undefined;
    }}
    {ondone}
  />
{/if}

<style>
  .lacking {
    margin: 0 0 6px;
  }

  .state {
    margin: 0 0 10px;
  }

  .still {
    display: block;
    width: 100%;
    max-width: 360px;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 6px;
    margin: 0 0 8px;
  }

  p {
    margin: 0;
  }

  h3 {
    margin: 0 0 6px;
    font-size: 14px;
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .version {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .version.absent {
    border-style: dashed;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .mono {
    overflow-wrap: anywhere;
    font-size: 12px;
  }

  .ok {
    color: var(--ok);
  }

  .missing {
    color: var(--danger);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }
</style>
