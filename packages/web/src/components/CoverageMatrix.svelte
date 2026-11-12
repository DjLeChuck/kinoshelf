<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import type { ShowDetail } from '../lib/library-items.js';
  import { slotsOf, type SlotStatus } from '../lib/versions.js';

  // Per season, a line per version and a square per episode: which version holds which episode,
  // and where its NFO is missing. Only the episodes some file holds are squares; an episode no
  // version holds is the "Missing episodes" of the show, counted elsewhere.
  let { detail }: { detail: ShowDetail } = $props();

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
      <p class="muted">
        {season.season === 0
          ? t('web.library.season.specials')
          : t('web.library.season', { season: season.season })}
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
              <span class="cell {status}" title={words}><span class="sr-only">{words}</span></span>
            {/each}
          </span>
          <span class="ratio">{version.covered}/{version.total}</span>
        </div>
      {/each}
    </div>
  {/each}
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
