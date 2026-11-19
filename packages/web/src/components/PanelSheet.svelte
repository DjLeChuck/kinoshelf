<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../lib/i18n.svelte.js';

  // The side panel of a list (the page of a work, of a collection): beside the list on a wide
  // screen; when `stacked` (no room beside the list) a selection is a sheet over the list with a bar
  // to close it, never a block under it.
  let {
    open,
    stacked = false,
    onclose,
    children,
  }: {
    /** Something is selected: when stacked, the panel covers the screen. */
    open: boolean;
    /** There is no room beside the list (a narrow screen, or a table too wide to share it). */
    stacked?: boolean;
    onclose: () => void;
    children: Snippet;
  } = $props();
</script>

<div class="side" class:sheet={open} class:stacked>
  {#if open && stacked}
    <div class="sheet-close">
      <button type="button" class="btn" onclick={onclose}>
        ← {t('web.library.panel.close')}
      </button>
    </div>
  {/if}
  <div class="body">
    {@render children()}
  </div>
</div>

<style>
  /* Floats beside the list while it scrolls; a tall panel scrolls on its own rather than past the screen. */
  .side {
    position: sticky;
    top: calc(var(--header-h, 0px) + 16px);
    max-height: calc(100vh - var(--header-h, 0px) - 32px);
    overflow-y: auto;
  }

  /* Never under the list: where there is no room beside it, a selection opens as a sheet over it
     (the page behind does not scroll: `html:has(.side.stacked.sheet)`, in app.css), and with
     nothing selected there is nothing to show. */
  .side.stacked:not(.sheet) {
    display: none;
  }

  .side.stacked.sheet {
    position: fixed;
    inset: 0;
    z-index: 30;
    max-height: none;
    padding: 0 16px 16px;
    background: var(--bg);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .stacked .sheet-close {
    position: sticky;
    top: 0;
    z-index: 3;
    display: flex;
    justify-content: flex-start;
    margin: 0 -16px 12px;
    padding: 8px 16px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }

  /* A sheet on a tablet width is not stretched across the screen. */
  .stacked .body {
    max-width: 760px;
    margin: 0 auto;
  }
</style>
