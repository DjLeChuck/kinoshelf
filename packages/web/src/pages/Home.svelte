<script lang="ts">
  import Welcome from '../components/Welcome.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { shell } from '../lib/shell-state.svelte.js';

  // Once the setup is left, the app opens on the libraries.
  $effect(() => {
    if (shell.onboarding?.completed) {
      router.navigate('/libraries', { replace: true });
    }
  });
</script>

{#if shell.onboarding === undefined || shell.onboarding.completed}
  <p class="muted" role="status">{t('web.loading')}</p>
{:else}
  <Welcome onboarding={shell.onboarding} />
{/if}
