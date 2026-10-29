<script lang="ts">
  import SettingsNav from '../components/SettingsNav.svelte';
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

  /** In page order: the nav lists them, and each wraps its section so a click can reach it. */
  const SECTIONS = [
    { id: 'general', label: 'web.settings.general.title' },
    { id: 'watch', label: 'web.settings.watch.title' },
    { id: 'processing', label: 'web.settings.processing.title' },
    { id: 'plex', label: 'web.settings.plex.title' },
    { id: 'jellyfin', label: 'web.settings.jellyfin.title' },
    { id: 'webhooks', label: 'web.settings.webhooks.title' },
    { id: 'aliases', label: 'web.settings.aliases.title' },
    { id: 'access', label: 'web.settings.access.title' },
  ] as const;

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

<div class="layout">
  <div class="page">
    <div>
      <h1>{t('web.settings.title')}</h1>
      <p class="muted">{t('web.settings.intro')}</p>
    </div>

    {#if failure}
      <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
      <button type="button" class="btn" onclick={() => void load()}>{t('web.retry')}</button>
    {:else if settings}
      <div id="general"><SettingsGeneral {settings} {save} /></div>
      <div id="watch"><SettingsWatch {settings} {save} /></div>
      <div id="processing"><SettingsProcessing {settings} {save} /></div>
      <div id="plex"><SettingsServer kind="plex" {settings} {save} /></div>
      <div id="jellyfin"><SettingsServer kind="jellyfin" {settings} {save} /></div>
      <div id="webhooks"><SettingsWebhooks {settings} {save} /></div>
      <div id="aliases"><SettingsAliases /></div>
      <div id="access"><SettingsAccess {settings} /></div>
    {:else}
      <p class="muted" role="status">{t('web.loading')}</p>
    {/if}
  </div>

  {#if settings}
    <SettingsNav sections={SECTIONS.map(({ id, label }) => ({ id, label: t(label) }))} />
  {/if}
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 760px) 200px;
    gap: 32px;
    align-items: start;
  }

  /* Short of room, the page is short enough to do without it. */
  @media (max-width: 1060px) {
    .layout {
      grid-template-columns: minmax(0, 760px);
    }

    .layout > :global(nav) {
      display: none;
    }
  }

  .page > :global(div[id]) {
    scroll-margin-top: 16px;
  }

  .page {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  h1 {
    font-size: 22px;
    margin-bottom: 4px;
  }
</style>
