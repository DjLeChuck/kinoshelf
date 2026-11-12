<script lang="ts">
  import Link from '../components/Link.svelte';
  import SystemLogs from '../components/SystemLogs.svelte';
  import { t } from '../lib/i18n.svelte.js';
</script>

<div class="page">
  <div class="head">
    <h1>{t('web.system.title')}</h1>
    <p class="muted">
      {t('web.system.intro')}
      <Link href="/settings">{t('web.system.intro.link')}</Link>
    </p>
  </div>

  <!-- One section for now: the tab strip comes with the second one (health, TMDB, diagnostic). -->
  <section aria-label={t('web.system.tab.logs')}>
    <SystemLogs />
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
</style>
