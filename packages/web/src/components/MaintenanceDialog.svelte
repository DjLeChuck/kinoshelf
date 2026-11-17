<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import type { TidyTally } from '../lib/maintenance.js';

  let {
    name,
    tally,
    onclose,
    onconfirm,
  }: {
    /** The library's name. */
    name: string;
    /** What the analysis found: this is what the confirmation commits to. */
    tally: TidyTally;
    onclose: () => void;
    onconfirm: () => void;
  } = $props();

  let dialog: HTMLDialogElement | undefined;

  $effect(() => {
    dialog?.showModal();
  });

  // What will move, one line each; a kind with nothing to do is not mentioned.
  const lines = $derived(
    [
      tally.folders > 0 && t('web.maintenance.confirm.folders', { count: tally.folders }),
      tally.renames > 0 && t('web.maintenance.confirm.renames', { count: tally.renames }),
      tally.removals > 0 && t('web.maintenance.confirm.removals', { count: tally.removals }),
      tally.subtitles > 0 && t('web.maintenance.confirm.subtitles', { count: tally.subtitles }),
    ].filter((line): line is string => line !== false),
  );
</script>

<dialog bind:this={dialog} class="card" aria-labelledby="maintenance-confirm-title" {onclose}>
  <header>
    <h2 id="maintenance-confirm-title">{t('web.maintenance.confirm.title', { name })}</h2>
    <button
      type="button"
      class="close"
      aria-label={t('web.maintenance.confirm.close')}
      onclick={() => dialog?.close()}>×</button
    >
  </header>

  <div class="body">
    <ul class="what">
      {#each lines as line (line)}<li>{line}</li>{/each}
    </ul>
    <p>{t('web.maintenance.confirm.kept')}</p>
    <p>{t('web.maintenance.confirm.undo')}</p>
    <p class="muted">{t('web.maintenance.confirm.tool')}</p>
  </div>

  <footer>
    <button type="button" class="btn" onclick={() => dialog?.close()}>
      {t('web.maintenance.confirm.cancel')}
    </button>
    <button
      type="button"
      class="btn btn-primary"
      onclick={() => {
        onconfirm();
        dialog?.close();
      }}
    >
      {t('web.maintenance.confirm.run')}
    </button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(540px, 94vw);
    max-height: 86vh;
    color: var(--text);
  }

  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow: hidden;
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
    flex: 1 1 auto;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    overflow: auto;
  }

  .what {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding-left: 20px;
    font-weight: 600;
  }

  footer {
    display: flex;
    flex: none;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
