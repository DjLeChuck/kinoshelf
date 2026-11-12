<script lang="ts">
  import Link from '../components/Link.svelte';
  import SystemLogs from '../components/SystemLogs.svelte';
  import SystemTmdb from '../components/SystemTmdb.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { oneOf } from '../lib/routes.js';

  // Health and the diagnostic archive join them in order: Health, Logs, TMDB, Diagnostic.
  const TABS = ['logs', 'tmdb'] as const;
  const tab = $derived(oneOf(router.query.get('tab'), TABS) ?? 'logs');
</script>

<div class="page">
  <div class="head">
    <h1>{t('web.system.title')}</h1>
    <p class="muted">
      {t('web.system.intro')}
      <Link href="/settings">{t('web.system.intro.link')}</Link>
    </p>
  </div>

  <nav class="tabs" aria-label={t('web.system.tabs')}>
    {#each TABS as id (id)}
      <Link
        href={id === 'logs' ? '/system' : `/system?tab=${id}`}
        class="tab"
        aria-current={tab === id ? 'page' : undefined}
      >
        {t(`web.system.tab.${id}`)}
      </Link>
    {/each}
  </nav>

  <section aria-label={t(`web.system.tab.${tab}`)}>
    {#if tab === 'tmdb'}
      <SystemTmdb />
    {:else}
      <SystemLogs />
    {/if}
  </section>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  h1 {
    font-size: 22px;
    margin-bottom: 4px;
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    border-bottom: 1px solid var(--border);
  }

  .tabs :global(.tab) {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 14px;
    border-bottom: 2px solid transparent;
    color: var(--muted);
    text-decoration: none;
  }

  .tabs :global(.tab[aria-current='page']) {
    border-bottom-color: var(--accent);
    color: var(--text);
    font-weight: 600;
  }
</style>
