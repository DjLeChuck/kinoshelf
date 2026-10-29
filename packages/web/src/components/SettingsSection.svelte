<script lang="ts">
  import type { Snippet } from 'svelte';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import { FormError } from '../lib/settings.js';

  let {
    title,
    onsubmit,
    children,
    actions,
    hideSave = false,
  }: {
    title: string;
    /** Throws what the user must hear (a refused value, an unreachable server). */
    onsubmit: () => Promise<void>;
    children: Snippet;
    /** Buttons beside Save. */
    actions?: Snippet;
    hideSave?: boolean;
  } = $props();

  let busy = $state(false);
  let failure = $state<unknown>(undefined);
  let saved = $state(false);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    failure = undefined;
    saved = false;
    try {
      await onsubmit();
      saved = true;
    } catch (error) {
      failure = error;
    } finally {
      busy = false;
    }
  }
</script>

<form class="card" onsubmit={submit}>
  <h2>{title}</h2>
  {@render children()}

  {#if failure}
    <p class="alert alert-danger" role="alert">
      {failure instanceof FormError ? failure.message : messageOf(t, failure)}
    </p>
  {/if}
  {#if saved}<p class="ok" role="status">{t('web.settings.saved')}</p>{/if}

  <div class="buttons">
    {#if !hideSave}
      <button type="submit" class="btn btn-primary" disabled={busy}>
        {busy ? t('web.settings.saving') : t('web.settings.save')}
      </button>
    {/if}
    {#if actions}{@render actions()}{/if}
  </div>
</form>

<style>
  h2 {
    font-size: 16px;
  }

  .ok {
    color: var(--ok);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
</style>
