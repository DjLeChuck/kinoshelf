<script lang="ts">
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { workLabel, type WorkDestination } from '../lib/work-destinations.js';

  let destinations = $state<readonly WorkDestination[] | undefined>(undefined);
  let busy = $state(false);
  let failure = $state<unknown>(undefined);

  async function load(): Promise<void> {
    try {
      destinations = await api.get<WorkDestination[]>('/api/work-destinations');
    } catch (error) {
      failure = error;
    }
  }

  async function forget(destination: WorkDestination): Promise<void> {
    busy = true;
    failure = undefined;
    try {
      await api.delete(`/api/work-destinations/${destination.kind}/${destination.tmdbId}`);
      destinations = destinations?.filter(
        (other) => other.kind !== destination.kind || other.tmdbId !== destination.tmdbId,
      );
    } catch (error) {
      failure = error;
    } finally {
      busy = false;
    }
  }

  refetchOn(['settings', 'ready'], () => void load());
</script>

<section class="card" aria-labelledby="destinations-title">
  <h2 id="destinations-title">{t('web.settings.destinations.title')}</h2>
  <p class="muted">{t('web.settings.destinations.hint')}</p>

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {/if}

  {#if destinations === undefined}
    <p class="muted" role="status">{t('web.loading')}</p>
  {:else if destinations.length === 0}
    <p class="muted">{t('web.settings.destinations.empty')}</p>
  {:else}
    <ul>
      {#each destinations as destination (`${destination.kind}:${destination.tmdbId}`)}
        {@const name = workLabel(destination)}
        <li>
          <span class="mono">{name}</span>
          <span aria-hidden="true">→</span>
          {#if destination.library}
            <span>{destination.library}</span>
          {:else}
            <span class="muted">{t('web.settings.destinations.gone')}</span>
          {/if}
          <button
            type="button"
            class="btn"
            disabled={busy}
            aria-label={t('web.settings.destinations.forget.label', { title: name })}
            onclick={() => void forget(destination)}
          >
            {t('web.settings.destinations.forget')}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  ul {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  li .btn {
    margin-left: auto;
  }
</style>
