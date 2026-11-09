<script lang="ts">
  import { formatBytes } from '@kinoshelf/i18n';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import {
    canNameVersion,
    canRun,
    episodeLabel,
    libraryItems,
    type Coverage,
    type ItemDetail,
    type LibraryItem,
    type ShowEpisode,
  } from '../lib/library-items.js';
  import { baseName } from '../lib/paths.js';
  import { codecLine, languageShort, slotsOf, versionLabel, type Slot } from '../lib/versions.js';
  import RunDialog from './RunDialog.svelte';
  import WorkCard from './WorkCard.svelte';

  let {
    libraryId,
    showTitle,
    episode,
    coverage,
    busy = false,
    ondone,
  }: {
    libraryId: string;
    showTitle: string;
    episode: ShowEpisode;
    /** The versions of the show, as its season lists them. */
    coverage: readonly Coverage[];
    busy?: boolean;
    /** A batch was queued: what to tell the user. */
    ondone: (message: string) => void;
  } = $props();

  // The parent keys this panel on the episode, so the files read here once are right for its life.
  let details = $state<Readonly<Record<string, ItemDetail>>>({});
  let failure = $state<unknown>(undefined);
  let running = $state<{ mode: 'rename' | 'refresh' | 'version'; item: LibraryItem } | undefined>(
    undefined,
  );

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
      formatBytes(file.size),
    ]
      .filter(Boolean)
      .join(' · ');
  };

  const nfoMissing = (slot: Slot): boolean => slot.status === 'nfo-missing';
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
            {#each detail?.nfoFiles ?? [] as nfo (nfo.path)}
              <p class="mono">
                <span class={nfo.present ? 'ok' : 'missing'} aria-hidden="true"
                  >{nfo.present ? '✓' : '✗'}</span
                >
                {baseName(nfo.path)}
                <span class="sr-only"
                  >: {t(nfo.present ? 'web.library.present' : 'web.library.missing')}</span
                >
              </p>
            {/each}
            <div class="actions">
              {#if canRun(file) && (nfoMissing(slot) || file.state === 'rename')}
                <button
                  type="button"
                  class="btn"
                  class:btn-primary={file.state === 'rename'}
                  disabled={busy}
                  onclick={() => {
                    running = {
                      mode: file.state === 'rename' ? 'rename' : 'refresh',
                      item: file,
                    };
                  }}
                >
                  {t(
                    file.state === 'rename' ? 'web.library.run.rename' : 'web.library.nfo.generate',
                  )}
                </button>
              {:else if canRun(file)}
                <button
                  type="button"
                  class="btn"
                  disabled={busy}
                  onclick={() => {
                    running = { mode: 'refresh', item: file };
                  }}
                >
                  {t('web.library.run.refresh')}
                </button>
              {/if}
              {#if canNameVersion(file)}
                <button
                  type="button"
                  class="btn"
                  disabled={busy}
                  onclick={() => {
                    running = { mode: 'version', item: file };
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

{#if running}
  <RunDialog
    {libraryId}
    items={[running.item]}
    mode={running.mode}
    onclose={() => {
      running = undefined;
    }}
    {ondone}
  />
{/if}

<style>
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
