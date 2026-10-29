<script lang="ts">
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import type { Settings } from '../lib/settings.js';

  let { settings }: { settings: Settings } = $props();

  let confirming = $state(false);
  let busy = $state(false);
  let failure = $state<unknown>(undefined);
  let fresh = $state<string | undefined>(undefined);
  let copied = $state(false);

  const fromEnv = $derived(settings.apiKey.source === 'env');

  async function replace(): Promise<void> {
    busy = true;
    failure = undefined;
    try {
      ({ apiKey: fresh } = await api.post<{ apiKey: string }>('/api/settings/api-key'));
      confirming = false;
    } catch (error) {
      failure = error;
    } finally {
      busy = false;
    }
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(fresh ?? '');
      copied = true;
    } catch {
      // Clipboard access can be refused: the key stays selectable on screen.
    }
  }
</script>

<section class="card" aria-labelledby="access-title">
  <h2 id="access-title">{t('web.settings.access.title')}</h2>

  {#if fromEnv}
    <p class="muted">{t('web.settings.access.env')}</p>
  {:else}
    <p class="muted">{t('web.settings.access.hint')}</p>

    {#if fresh}
      <div class="field" role="status">
        <label for="new-key">{t('web.settings.access.new')}</label>
        <input
          id="new-key"
          class="input mono"
          readonly
          value={fresh}
          onfocus={(e) => {
            e.currentTarget.select();
          }}
        />
        <button type="button" class="btn" onclick={() => void copy()}>
          {copied ? t('web.settings.access.copied') : t('web.settings.access.copy')}
        </button>
      </div>
    {:else if confirming}
      <div class="buttons">
        <button
          type="button"
          class="btn btn-primary"
          disabled={busy}
          onclick={() => void replace()}
        >
          {t('web.settings.access.confirm')}
        </button>
        <button
          type="button"
          class="btn"
          disabled={busy}
          onclick={() => {
            confirming = false;
          }}
        >
          {t('web.settings.access.cancel')}
        </button>
      </div>
    {:else}
      <div class="buttons">
        <button
          type="button"
          class="btn"
          onclick={() => {
            confirming = true;
          }}
        >
          {t('web.settings.access.replace')}
        </button>
      </div>
    {/if}
  {/if}

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {/if}
</section>

<style>
  h2 {
    font-size: 16px;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .field .btn {
    align-self: flex-start;
  }
</style>
