<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import { posterUrl } from '../lib/queue.js';

  let { path }: { path: string | undefined } = $props();

  let broken = $state(false);
  const src = $derived(broken ? undefined : posterUrl(path));
</script>

<!-- Decorative: the title is always written next to it. -->
{#if src}
  <img {src} alt="" width="46" height="69" loading="lazy" onerror={() => (broken = true)} />
{:else}
  <span class="none" title={t('web.queue.no-poster')} aria-hidden="true"></span>
{/if}

<style>
  img,
  .none {
    display: block;
    flex: none;
    width: 46px;
    height: 69px;
    border-radius: 4px;
    background: var(--surface-2);
  }

  img {
    object-fit: cover;
  }
</style>
