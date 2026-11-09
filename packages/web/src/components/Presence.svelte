<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';

  // A file's presence in a table cell: green when it is there, red when it is not, nothing when the
  // profile writes no such file. The word is for a screen reader; the colour is not the only sign.
  let { value }: { value: boolean | null } = $props();
</script>

{#if value !== null}
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
</style>
