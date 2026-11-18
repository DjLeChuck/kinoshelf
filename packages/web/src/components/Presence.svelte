<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import Tip from './Tip.svelte';

  // A file's presence in a table cell: green when it is there, red when it is not, nothing when the
  // profile writes no such file. `unavailable` (the provider has none to offer) is a plain dash: it
  // is neither there nor missing, so no colour. The word is for a screen reader; the colour is not
  // the only sign.
  let { value, unavailable = false }: { value: boolean | null; unavailable?: boolean } = $props();
</script>

{#if unavailable}
  <Tip text={t('web.library.unavailable')}>
    {#snippet children(describedby)}
      <span class="none" aria-describedby={describedby}>
        <span aria-hidden="true">—</span>
        <span class="sr-only">{t('web.library.unavailable')}</span>
      </span>
    {/snippet}
  </Tip>
{:else if value !== null}
  <span class={value ? 'ok' : 'missing'}>
    <span aria-hidden="true">{value ? '✓' : '✗'}</span>
    <span class="sr-only">{t(value ? 'web.library.present' : 'web.library.missing')}</span>
  </span>
{/if}

<style>
  .ok {
    color: var(--ok);
  }

  .missing {
    color: var(--danger);
  }

  .none {
    color: var(--muted, inherit);
  }
</style>
