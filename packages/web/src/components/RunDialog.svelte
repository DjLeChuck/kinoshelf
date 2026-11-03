<script lang="ts">
  import { baseName } from '../lib/paths.js';
  import { describeError } from '@kinoshelf/i18n';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import {
    libraryItems,
    tally,
    type LibraryItem,
    type ReportOperation,
    type RunReport,
  } from '../lib/library-items.js';

  let {
    libraryId,
    items,
    mode,
    onclose,
    ondone,
  }: {
    libraryId: string;
    /** The items to run: what the preview shows and the run does. */
    items: readonly LibraryItem[];
    mode: 'rename' | 'refresh';
    onclose: () => void;
    /** The batch was queued: what to tell the user. */
    ondone: (message: string) => void;
  } = $props();

  let report = $state<RunReport | undefined>(undefined);
  let failure = $state<unknown>(undefined);
  let running = $state(false);
  let dialog: HTMLDialogElement | undefined;

  // The parent mounts this dialog for one selection, so what is read here once is right for its life.
  /* svelte-ignore state_referenced_locally */
  const ids = items.map(({ id }) => id);

  $effect(() => {
    dialog?.showModal();
  });

  async function load(): Promise<void> {
    try {
      report = await libraryItems.preview(libraryId, ids);
    } catch (error) {
      failure = error;
    }
  }
  void load();

  async function run(): Promise<void> {
    running = true;
    try {
      await libraryItems.run(libraryId, ids);
      ondone(t('web.library.run.started'));
    } catch (error) {
      failure = error;
      running = false;
    }
  }

  const byEntry = $derived(new Map(items.map((item) => [item.entryId, item])));
  const totals = $derived(report ? tally(report) : undefined);
  const nameOf = (item: LibraryItem | undefined, fallback: string): string =>
    item?.title ?? (item ? baseName(item.path) : fallback);
  const blocked = (operation: ReportOperation): string | undefined =>
    operation.error ? describeError(t, operation.error) : undefined;
</script>

<dialog bind:this={dialog} class="card" aria-labelledby="run-title" {onclose}>
  <h2 id="run-title">{t(`web.library.run.title.${mode}`)}</h2>

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {:else if report === undefined || totals === undefined}
    <p class="muted" role="status">{t('web.loading')}</p>
  {:else}
    <p class="muted">{t('web.library.run.summary', totals)}</p>
    {#if report.skipped.length > 0}
      <p class="muted">{t('web.library.run.skipped', { count: report.skipped.length })}</p>
    {/if}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t('web.library.run.col.file')}</th>
            <th>{t('web.library.run.col.what')}</th>
            <th>{t('web.library.run.col.to')}</th>
          </tr>
        </thead>
        <tbody>
          {#each report.items as entry (entry.entryId)}
            {#each entry.results as operation, index (index)}
              <tr>
                <td>{index === 0 ? nameOf(byEntry.get(entry.entryId), entry.entryId) : ''}</td>
                <td>
                  {t(`web.library.run.op.${operation.type}`)}
                  {#if operation.status === 'skipped'}
                    <span class="chip chip-neutral">{t('web.library.run.exists')}</span>
                  {:else if operation.status === 'failed'}
                    <span class="chip chip-danger" title={blocked(operation)}
                      >{t('web.library.run.blocked')}</span
                    >
                  {/if}
                </td>
                <td class="mono dest">{operation.destination}</td>
              </tr>
            {/each}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <div class="actions">
    <button type="button" class="btn" onclick={() => dialog?.close()}>
      {t('web.library.run.cancel')}
    </button>
    <button
      type="button"
      class="btn btn-primary"
      disabled={running || report === undefined || totals?.failed !== 0}
      onclick={() => void run()}
    >
      {t('web.library.run.confirm')}
    </button>
  </div>
</dialog>

<style>
  dialog {
    width: min(960px, 94vw);
    max-height: 86vh;
    overflow: auto;
    color: var(--text);
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 50%);
  }

  h2 {
    font-size: 18px;
    margin: 0 0 8px;
  }

  p {
    margin: 0 0 8px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
  }

  th {
    color: var(--muted);
    font-size: 12px;
  }

  .dest {
    font-size: 11.5px;
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
