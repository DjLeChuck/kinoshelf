<script lang="ts">
  import HomeDashboard from '../components/HomeDashboard.svelte';
  import Welcome from '../components/Welcome.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { shell } from '../lib/shell-state.svelte.js';
</script>

{#if shell.onboarding === undefined}
  <p class="muted" role="status">{t('web.loading')}</p>
{:else if shell.onboarding.completed}
  <HomeDashboard />
{:else}
  <Welcome onboarding={shell.onboarding} />
{/if}
