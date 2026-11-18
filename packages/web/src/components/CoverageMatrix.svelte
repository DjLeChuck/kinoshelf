<script lang="ts">
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import { libraryItems, type ShowDetail } from '../lib/library-items.js';
  import { isIncomplete, slotsOf, type SlotStatus } from '../lib/versions.js';
  import Tip from './Tip.svelte';

  // Per season, a line per version and a square per episode: which version holds which episode,
  // and where its NFO is missing. Only the episodes some file holds are squares; an episode no
  // version holds is the "Missing episodes" of the show, counted elsewhere.
  // A season held in several versions where one lacks what the others have can be accepted as it
  // is (no better release exists): it then stops counting as incomplete until its files change.
  let { libraryId, detail }: { libraryId: string; detail: ShowDetail } = $props();

  let busy = $state<number | undefined>(undefined);
  let failure = $state<unknown>(undefined);

  async function accept(season: number, value: boolean): Promise<void> {
    busy = season;
    failure = undefined;
    try {
      await libraryItems.acceptSeason(libraryId, detail.tmdbId, season, value);
    } catch (error) {
      failure = error;
    } finally {
      busy = undefined;
    }
  }

  const STATUSES: readonly SlotStatus[] = ['complete', 'nfo-missing', 'absent'];

  const seasons = $derived(
    detail.seasons
      .map((season) => ({
        ...season,
        held: season.episodes.filter(({ versions }) => versions.length > 0),
      }))
      .filter(({ held }) => held.length > 0),
  );
</script>

<div>
  {#each seasons as season (season.season)}
    <div class="season">
      <p class="muted heading">
        {season.season === 0
          ? t('web.library.season.specials')
          : t('web.library.season', { season: season.season })}
        {#if season.acknowledged}
          · {t('web.library.coverage.accepted')}
          <button
            type="button"
            class="link"
            disabled={busy === season.season}
            onclick={() => void accept(season.season, false)}
            >{t('web.library.coverage.accepted.undo')}</button
          >
        {:else if season.versions.some(isIncomplete)}
          <Tip text={t('web.library.coverage.accept.hint')}>
            {#snippet children(describedby)}
              <button
                type="button"
                class="link"
                disabled={busy === season.season}
                aria-describedby={describedby}
                onclick={() => void accept(season.season, true)}
                >{t('web.library.coverage.accept')}</button
              >
            {/snippet}
          </Tip>
        {/if}
      </p>
      {#each season.versions as version, index (version.resolution ?? '')}
        {@const name = version.resolution ?? t('web.library.version.unknown')}
        <div class="line">
          <span class="name">{name}</span>
          <span class="cells">
            {#each season.held as episode (episode.episode)}
              {@const status =
                slotsOf(season.versions, episode.versions)[index]?.status ?? 'absent'}
              {@const words = t('web.library.coverage.cell', {
                episode: episode.episode,
                version: name,
                status: t(`web.library.version.status.${status}`),
              })}
              <!-- Native on purpose: a season draws hundreds of these, one popover each would weigh the page. -->
              <span class="cell {status}" title={words}><span class="sr-only">{words}</span></span>
            {/each}
          </span>
          <span class="ratio">{version.covered}/{version.total}</span>
        </div>
      {/each}
    </div>
  {/each}
  {#if failure !== undefined}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {/if}
  <ul class="legend" aria-label={t('web.library.coverage.legend.label')}>
    {#each STATUSES as status (status)}
      <li>
        <span class="cell {status}" aria-hidden="true"></span>{t(
          `web.library.version.status.${status}`,
        )}
      </li>
    {/each}
  </ul>
</div>

<style>
  p {
    margin: 0;
  }

  .heading {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 8px;
  }

  .season {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .name {
    flex: none;
    width: 5.5em;
    font-size: 12px;
  }

  .cells {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    gap: 3px;
  }

  .ratio {
    flex: none;
    color: var(--muted);
    font-size: 12px;
  }

  .cell {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 1px solid transparent;
    border-radius: 3px;
  }

  .cell.complete {
    background: var(--muted);
    opacity: 0.55;
  }

  .cell.nfo-missing {
    background: var(--warn);
  }

  .cell.absent {
    border: 1px dashed var(--muted);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin: 0;
    padding: 0;
    color: var(--muted);
    font-size: 12px;
    list-style: none;
  }

  .legend li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
</style>
