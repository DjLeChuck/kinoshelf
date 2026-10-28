<script lang="ts">
  import Link from '../components/Link.svelte';
  import { t } from '../lib/i18n.svelte.js';
</script>

<section class="card">
  <h1>{t('web.not-found.title')}</h1>
  <p><Link href="/">{t('web.not-found.back')}</Link></p>
</section>
