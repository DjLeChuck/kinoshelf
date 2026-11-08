<script lang="ts">
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { childOf, openAt, type FolderListing } from '../lib/folders.js';
  import { t } from '../lib/i18n.svelte.js';

  let {
    id,
    start,
    kind = 'folder',
    onchoose,
    onclose,
  }: {
    id: string;
    /** What is typed in the field: the panel opens there, or at the nearest folder that exists. */
    start: string;
    /** `file` picks a YAML file (a profile); `folder` picks a folder. */
    kind?: 'folder' | 'file';
    onchoose: (path: string) => void;
    onclose: () => void;
  } = $props();

  let dialog: HTMLDialogElement | undefined;
  let loading = $state(false);
  let listing = $state<FolderListing | undefined>(undefined);
  let failure = $state<unknown>(undefined);

  async function go(path: string): Promise<void> {
    loading = true;
    failure = undefined;
    try {
      listing = await openAt(api.get, path, kind === 'file' ? 'yaml' : undefined);
    } catch (error) {
      failure = error;
    } finally {
      loading = false;
    }
  }

  // Opened once per mounting: the parent mounts it when the user asks to browse.
  /* svelte-ignore state_referenced_locally */
  void go(start);

  // A modal: the list is not squeezed under the field it fills. Escape and the backdrop's own
  // close go through the dialog's `close` event, which tells the parent.
  $effect(() => {
    dialog?.showModal();
  });
</script>

<dialog
  bind:this={dialog}
  class="card browser"
  id="{id}-browser"
  aria-label={t('web.path.browser')}
  {onclose}
>
  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {:else if !listing}
    <p class="muted" role="status">{t('web.path.loading')}</p>
  {:else}
    <p class="mono current" aria-live="polite">{listing.path}</p>
    <ul aria-busy={loading}>
      {#if listing.parent !== null}
        <li>
          <button type="button" class="entry" onclick={() => void go(listing?.parent ?? '/')}>
            <span aria-hidden="true">↑</span>
            {t('web.path.up')}
          </button>
        </li>
      {/if}
      {#each listing.entries as entry (entry.name)}
        <li>
          {#if entry.kind === 'directory'}
            <button
              type="button"
              class="entry"
              onclick={() => void go(childOf(listing?.path ?? '/', entry.name))}
            >
              <span aria-hidden="true">📁</span>
              {entry.name}
            </button>
          {:else}
            <button
              type="button"
              class="entry file"
              onclick={() => {
                onchoose(childOf(listing?.path ?? '/', entry.name));
              }}
            >
              <span aria-hidden="true">📄</span>
              {entry.name}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
    {#if listing.entries.length === 0}
      <p class="muted">{t(kind === 'file' ? 'web.path.empty.file' : 'web.path.empty')}</p>
    {/if}
    {#if listing.truncated}
      <p class="muted">{t('web.path.truncated')}</p>
    {/if}
  {/if}
  <div class="actions">
    {#if kind === 'folder' && listing}
      <button
        type="button"
        class="btn btn-primary"
        onclick={() => {
          onchoose(listing?.path ?? '');
        }}
      >
        {t('web.path.use')}
      </button>
    {/if}
    <button type="button" class="btn" onclick={() => dialog?.close()}>
      {t('web.path.close')}
    </button>
  </div>
</dialog>

<style>
  .browser {
    /* A fixed size: one that follows the folder it shows jumps at every click. Only the list scrolls. */
    width: min(560px, 94vw);
    height: min(520px, 86vh);
    color: var(--text);
  }

  .browser[open] {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .browser::backdrop {
    background: rgb(0 0 0 / 50%);
  }

  .current {
    margin: 0;
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  ul {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .entry {
    display: flex;
    gap: 8px;
    width: 100%;
    min-height: 36px;
    padding: 0 8px;
    align-items: center;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .entry:hover,
  .entry:focus-visible {
    background: var(--border);
  }

  .actions {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
