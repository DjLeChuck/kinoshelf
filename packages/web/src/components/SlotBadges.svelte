<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import type { Slot } from '../lib/versions.js';

  // The versions of the show, as one episode stands against them: full when a file holds it, dashed
  // when the show has that version but not for this episode, with an orange dot when the NFO of
  // the file is missing. The words are for a screen reader; the shape and the colour are not alone.
  let { slots }: { slots: readonly Slot[] } = $props();
</script>

<span class="badges">
  {#each slots as slot (slot.resolution ?? '')}
    <span class="chip chip-neutral" class:absent={slot.status === 'absent'}>
      {slot.resolution ?? t('web.library.version.unknown')}
      {#if slot.status === 'nfo-missing'}<span class="dot" aria-hidden="true"></span>{/if}
      {#if slot.status !== 'complete'}
        <span class="sr-only">: {t(`web.library.version.status.${slot.status}`)}</span>
      {/if}
    </span>
  {/each}
</span>

<style>
  .badges {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .absent {
    background: none;
    border: 1px dashed var(--muted);
  }

  .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-left: 4px;
    border-radius: 50%;
    background: var(--warn);
  }
</style>
