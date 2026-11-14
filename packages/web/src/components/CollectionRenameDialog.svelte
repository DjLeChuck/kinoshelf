<script lang="ts">
  import { collectionsApi, resultNotice, type CollectionCard } from '../lib/collections.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';

  let {
    libraryId,
    collection,
    onclose,
    ondone,
  }: {
    libraryId: string;
    collection: CollectionCard;
    onclose: () => void;
    /** Renamed: the new key, and what to tell. */
    ondone: (key: string, message: string) => void;
  } = $props();

  /* svelte-ignore state_referenced_locally */
  let name = $state(collection.name);
  /** The NFO a rename would rewrite, once counted: the confirmation names it. */
  let planned = $state<number | undefined>(undefined);
  let working = $state(false);
  let failure = $state<unknown>(undefined);
  let dialog: HTMLDialogElement | undefined;

  $effect(() => {
    dialog?.showModal();
  });

  const trimmed = $derived(name.trim());
  const changed = $derived(trimmed !== '' && trimmed !== collection.name);

  async function check(): Promise<void> {
    working = true;
    failure = undefined;
    try {
      planned = (await collectionsApi.rename(libraryId, collection.key, trimmed, true)).rewritten;
    } catch (error) {
      failure = error;
    } finally {
      working = false;
    }
  }

  async function rename(): Promise<void> {
    working = true;
    failure = undefined;
    try {
      const result = await collectionsApi.rename(libraryId, collection.key, trimmed, false);
      ondone(result.key, resultNotice(result, t));
      dialog?.close();
    } catch (error) {
      failure = error;
      working = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="rename-title"
  {onclose}
  oncancel={(event) => {
    if (working) {
      event.preventDefault();
    }
  }}
>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void (planned === undefined ? check() : rename());
    }}
  >
    <h2 id="rename-title">{t('web.collections.rename.title', { name: collection.name })}</h2>
    <p class="muted">{t('web.collections.rename.intro')}</p>
    <label for="rename-name">{t('web.collection.name')}</label>
    <input
      id="rename-name"
      class="input"
      bind:value={name}
      maxlength="200"
      disabled={working || planned !== undefined}
    />
    {#if planned !== undefined}
      <p class="alert alert-warn" role="status">
        {t('web.collections.rename.confirm', { name: trimmed, count: planned })}
      </p>
    {/if}
    {#if failure !== undefined}<p class="alert alert-danger" role="alert">
        {messageOf(t, failure)}
      </p>{/if}
    <div class="actions">
      <button type="button" class="btn" disabled={working} onclick={() => dialog?.close()}
        >{t('web.images.cancel')}</button
      >
      {#if planned !== undefined}
        <button
          type="button"
          class="btn"
          disabled={working}
          onclick={() => {
            planned = undefined;
          }}>{t('web.collections.rename.back')}</button
        >
      {/if}
      <button type="submit" class="btn btn-primary" disabled={!changed || working}>
        {#if working}{t('web.loading')}{:else if planned === undefined}{t(
            'web.collections.rename.check',
          )}{:else}{t('web.collections.rename.apply', { count: planned })}{/if}
      </button>
    </div>
  </form>
</dialog>

<style>
  dialog {
    width: min(520px, 94vw);
    padding: 0;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 55%);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 24px;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 18px;
  }

  .input {
    min-height: 44px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
