<script lang="ts">
  import SettingsNav from '../components/SettingsNav.svelte';
  import SettingsAccess from '../components/SettingsAccess.svelte';
  import SettingsGeneral from '../components/SettingsGeneral.svelte';
  import SettingsLibraries from '../components/SettingsLibraries.svelte';
  import SettingsWatch from '../components/SettingsWatch.svelte';
  import SettingsProcessing from '../components/SettingsProcessing.svelte';
  import SettingsRetention from '../components/SettingsRetention.svelte';
  import SettingsServer from '../components/SettingsServer.svelte';
  import SettingsWebhooks from '../components/SettingsWebhooks.svelte';
  import { tick, untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { DEFAULT_METADATA, DEFAULT_NAMING, type Settings } from '../lib/settings.js';

  /** In page order: the nav lists them by group, and each wraps its section so a click can reach it. */
  const SECTIONS = [
    { id: 'general', label: 'web.settings.general.title', group: 'base' },
    { id: 'libraries', label: 'web.settings.libraries.title', group: 'base' },
    { id: 'access', label: 'web.settings.access.title', group: 'base' },
    { id: 'watch', label: 'web.settings.watch.title', group: 'processing' },
    { id: 'processing', label: 'web.settings.processing.title', group: 'processing' },
    { id: 'retention', label: 'web.settings.retention.title', group: 'processing' },
    { id: 'plex', label: 'web.settings.plex.title', group: 'integrations' },
    { id: 'jellyfin', label: 'web.settings.jellyfin.title', group: 'integrations' },
    { id: 'webhooks', label: 'web.settings.webhooks.title', group: 'integrations' },
  ] as const;

  let settings = $state<Settings | undefined>(undefined);
  let failure = $state<unknown>(undefined);

  async function load(): Promise<void> {
    try {
      settings = await api.get<Settings>('/api/settings');
      failure = undefined;
    } catch (error) {
      failure = error;
    }
  }

  // The sections come once the settings are loaded, so the browser cannot scroll to an anchor
  // (`/settings#retention`, from a link of the System page) by itself.
  // Read once, when they arrive: the menu then changes the anchor as the reader scrolls, and
  // following it here would pull the page back.
  $effect(() => {
    const anchor = untrack(() => router.hash).slice(1);
    if (settings && anchor !== '') {
      void tick().then(() => document.getElementById(anchor)?.scrollIntoView());
    }
  });

  // Loaded once. A refetch on every `settings` event would replace the page under a form being
  // edited, and our own saves already bring back the new state.
  void load();

  /** Each section saves only what it owns; a refused value throws and the section shows it. */
  async function save(patch: object): Promise<void> {
    settings = await api.patch<Settings>('/api/settings', patch);
  }
</script>

{#snippet group(id: (typeof SECTIONS)[number]['group'])}
  <h2 class="group">{t(`web.settings.group.${id}`)}</h2>
{/snippet}

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
      {@render group('base')}
      <div id="general"><SettingsGeneral {settings} {save} /></div>
      <div id="libraries">
        <SettingsLibraries
          examples={settings.namingExamples}
          defaults={{
            naming: settings.processing.naming ?? DEFAULT_NAMING,
            metadata: settings.processing.metadata ?? DEFAULT_METADATA,
          }}
        />
      </div>
      <div id="access"><SettingsAccess {settings} /></div>
      {@render group('processing')}
      <div id="watch"><SettingsWatch {settings} {save} /></div>
      <div id="processing"><SettingsProcessing {settings} {save} /></div>
      <div id="retention"><SettingsRetention {settings} {save} /></div>
      {@render group('integrations')}
      <div id="plex"><SettingsServer kind="plex" {settings} {save} /></div>
      <div id="jellyfin"><SettingsServer kind="jellyfin" {settings} {save} /></div>
      <div id="webhooks"><SettingsWebhooks {settings} {save} /></div>
    {:else}
      <p class="muted" role="status">{t('web.loading')}</p>
    {/if}
  </div>

  {#if settings}
    <SettingsNav
      sections={SECTIONS.map(({ id, label, group }) => ({
        id,
        label: t(label),
        group: t(`web.settings.group.${group}`),
      }))}
    />
  {/if}
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 760px) 200px;
    /* The page and its nav sit in the middle of the shared width, not against its left edge. */
    justify-content: center;
    gap: 32px;
    align-items: start;
  }

  /* Short of room, the nav becomes a bar of chips above the page, kept in view while scrolling. */
  @media (max-width: 1060px) {
    .layout {
      grid-template-columns: minmax(0, 760px);
    }

    .layout > :global(nav) {
      order: -1;
    }
  }

  .page > :global(div[id]) {
    /* Under the sticky header, and under the chip bar when the nav is one (about 56px). */
    scroll-margin-top: calc(var(--header-h, 0px) + 72px);
  }

  .page {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .group {
    margin: 16px 0 0;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .group:first-of-type {
    margin-top: 0;
  }

  h1 {
    font-size: 22px;
    margin-bottom: 4px;
  }
</style>
