<script lang="ts">
  import SettingsAliases from '../components/SettingsAliases.svelte';
  import SettingsAccess from '../components/SettingsAccess.svelte';
  import SettingsGeneral from '../components/SettingsGeneral.svelte';
  import SettingsWatch from '../components/SettingsWatch.svelte';
  import SettingsProcessing from '../components/SettingsProcessing.svelte';
  import SettingsServer from '../components/SettingsServer.svelte';
  import SettingsWebhooks from '../components/SettingsWebhooks.svelte';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import type { Settings } from '../lib/settings.js';

  let settings = $state<Settings | undefined>(undefined);
  let failure = $state<unknown>(undefined);

  async function load(): Promise<void> {
    try {
      settings = await api.get<Settings>('/api/settings');
    } catch (error) {
      failure = error;
    }
  }

  // Loaded once. A refetch on every `settings` event would replace the page under a form being
  // edited, and our own saves already bring back the new state.
  void load();

  /** Each section saves only what it owns; a refused value throws and the section shows it. */
  async function save(patch: object): Promise<void> {
    settings = await api.patch<Settings>('/api/settings', patch);
  }
</script>

<div class="page">
  <div>
    <h1>{t('web.settings.title')}</h1>
    <p class="muted">{t('web.settings.intro')}</p>
  </div>

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
    <button type="button" class="btn" onclick={() => void load()}>{t('web.retry')}</button>
  {:else if settings}
    <SettingsGeneral {settings} {save} />
    <SettingsWatch {settings} {save} />
    <SettingsProcessing {settings} {save} />
    <SettingsServer kind="plex" {settings} {save} />
    <SettingsServer kind="jellyfin" {settings} {save} />
    <SettingsWebhooks {settings} {save} />
    <SettingsAliases />
    <SettingsAccess {settings} />
  {:else}
    <p class="muted" role="status">{t('web.loading')}</p>
  {/if}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 760px;
  }

  h1 {
    font-size: 22px;
    margin-bottom: 4px;
  }
</style>
