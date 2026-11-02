<script lang="ts">
  import Welcome from '../components/Welcome.svelte';
  import { messageOf } from '../lib/errors.js';
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

{#if shell.onboarding === undefined && shell.onboardingFailure !== undefined}
  <p class="alert alert-danger" role="alert">{messageOf(t, shell.onboardingFailure)}</p>
  <button type="button" class="btn" onclick={() => void shell.loadOnboarding()}
    >{t('web.retry')}</button
  >
{:else if shell.onboarding === undefined || shell.onboarding.completed}
  <p class="muted" role="status">{t('web.loading')}</p>
{:else}
  <Welcome onboarding={shell.onboarding} />
{/if}
