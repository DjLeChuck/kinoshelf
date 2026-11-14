<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';

  let {
    title,
    does,
    keeps,
    confirm,
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
    onclose: () => void;
    onconfirm: () => void;
  } = $props();

  let dialog: HTMLDialogElement | undefined;

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
    <p class="muted">{keeps}</p>
  </div>

  <footer>
    <button type="button" class="btn" onclick={() => dialog?.close()}>
      {t('web.maintenance.action.confirm.cancel')}
    </button>
    <button
      type="button"
      class="btn btn-primary"
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

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
