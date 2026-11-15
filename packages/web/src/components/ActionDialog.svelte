<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';

  let {
    title,
    does,
    keeps,
    confirm,
    extra,
    acknowledge,
    onclose,
    onconfirm,
  }: {
    title: string;
    /** What the action does. */
    does: string;
    /** What it leaves alone. */
    keeps: string;
    /** The label of the button that starts it. */
    confirm: string;
    /** More paragraphs, for an action with consequences to spell out. */
    extra?: string[] | undefined;
    /** A box to tick before the action can start: the one that cannot be undone. */
    acknowledge?: string | undefined;
    onclose: () => void;
    onconfirm: () => void;
  } = $props();

  let dialog: HTMLDialogElement | undefined;
  let understood = $state(false);

  $effect(() => {
    dialog?.showModal();
  });
</script>

<dialog bind:this={dialog} class="card" aria-labelledby="action-confirm-title" {onclose}>
  <header>
    <h2 id="action-confirm-title">{t('web.maintenance.action.confirm.title', { title })}</h2>
    <button
      type="button"
      class="close"
      aria-label={t('web.maintenance.action.confirm.close')}
      onclick={() => dialog?.close()}>×</button
    >
  </header>

  <div class="body">
    <p>{does}</p>
    {#each extra ?? [] as line (line)}<p>{line}</p>{/each}
    <p class="muted">{keeps}</p>
    {#if acknowledge}
      <label class="check">
        <input type="checkbox" bind:checked={understood} />
        <span>{acknowledge}</span>
      </label>
    {/if}
  </div>

  <footer>
    <button type="button" class="btn" onclick={() => dialog?.close()}>
      {t('web.maintenance.action.confirm.cancel')}
    </button>
    <button
      type="button"
      class="btn btn-primary"
      disabled={acknowledge !== undefined && !understood}
      onclick={() => {
        onconfirm();
        dialog?.close();
      }}
    >
      {confirm}
    </button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(480px, 94vw);
    color: var(--text);
  }

  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 50%);
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  h2 {
    margin: 0;
    font-size: 18px;
  }

  p {
    margin: 0;
  }

  .close {
    flex: none;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: var(--muted);
    font-size: 24px;
    cursor: pointer;
  }

  .close:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .check {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-height: 44px;
    cursor: pointer;
    font-weight: 600;
  }

  .check input {
    flex: none;
    width: 18px;
    height: 18px;
    margin: 2px 0 0;
    accent-color: var(--accent);
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
