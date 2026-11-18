<script lang="ts">
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import { imdbNfoMessage, type ImdbNfoOutcome } from '../lib/imdb-nfo.js';
  import Link from './Link.svelte';
  import Tip from './Tip.svelte';

  let {
    libraryId,
    tmdbId,
  }: {
    libraryId: string;
    tmdbId: number;
  } = $props();

  let busy = $state(false);
  let failure = $state<unknown>(undefined);
  let outcome = $state<ImdbNfoOutcome | undefined>(undefined);

  async function run(): Promise<void> {
    busy = true;
    failure = undefined;
    outcome = undefined;
    try {
      outcome = await api.post<ImdbNfoOutcome>(`/api/libraries/${libraryId}/imdb-nfo`, { tmdbId });
    } catch (error) {
      failure = error;
    } finally {
      busy = false;
    }
  }
</script>

<Tip text={t('web.imdb-nfo.hint')}>
  {#snippet children(describedby)}
    <button
      type="button"
      class="btn"
      disabled={busy}
      aria-describedby={describedby}
      onclick={() => void run()}>{t('web.imdb-nfo.button')}</button
    >
  {/snippet}
</Tip>
{#if failure !== undefined}
  <span class="alert alert-danger" role="alert">{messageOf(t, failure)}</span>
{:else if outcome}
  <span class="muted" role="status">
    {imdbNfoMessage(outcome, t)}
    {#if outcome.batchId}<Link href={`/history/${outcome.batchId}`}
        >{t('web.imdb-nfo.history')}</Link
      >{/if}
  </span>
{/if}
