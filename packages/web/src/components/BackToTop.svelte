<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';

  // Far enough that the header and the filters are out of sight, so a short page never shows it.
  const THRESHOLD = 600;

  let scrolled = $state(false);

  function top(): void {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
  }
</script>

<svelte:window
  onscroll={() => {
    scrolled = window.scrollY > THRESHOLD;
  }}
/>

{#if scrolled}
  <button type="button" class="top btn" onclick={top} aria-label={t('web.back-to-top')}>
    <span aria-hidden="true">↑</span>
    {t('web.back-to-top')}
  </button>
{/if}

<style>
  /* Left, since the activity panel owns the bottom right. */
  .top {
    position: fixed;
    left: 16px;
    bottom: 16px;
    z-index: 20;
    /* Opaque: it floats over the list, and a transparent button lets the text show through. */
    background: var(--surface);
    box-shadow: 0 2px 10px rgb(0 0 0 / 30%);
  }

  .top:hover:not(:disabled) {
    background: var(--surface-2);
  }
</style>
