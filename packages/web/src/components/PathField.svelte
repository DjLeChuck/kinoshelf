<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import FolderBrowser from './FolderBrowser.svelte';

  let {
    id,
    value = $bindable(''),
    kind = 'folder',
    placeholder,
    open = $bindable(false),
  }: {
    id: string;
    value?: string;
    /** `file` picks a YAML file (a profile); `folder` picks a folder. */
    kind?: 'folder' | 'file';
    placeholder?: string;
    /** Whether the folder browser is shown. */
    open?: boolean;
  } = $props();
</script>

<div class="path">
  <input {id} class="input mono" {placeholder} bind:value />
  <button
    type="button"
    class="btn"
    aria-expanded={open}
    aria-controls="{id}-browser"
    onclick={() => {
      open = !open;
    }}
  >
    {t('web.path.browse')}
  </button>
</div>

{#if open}
  <FolderBrowser
    {id}
    {kind}
    start={value}
    onchoose={(path: string) => {
      value = path;
      open = false;
    }}
    onclose={() => {
      open = false;
    }}
  />
{/if}

<style>
  .path {
    display: flex;
    gap: 8px;
  }

  .path .input {
    flex: 1 1 auto;
    min-width: 0;
  }
</style>
