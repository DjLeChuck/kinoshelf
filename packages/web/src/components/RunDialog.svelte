<script lang="ts">
  import { baseName } from '../lib/paths.js';
  import { describeError } from '@kinoshelf/i18n';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import {
    libraryItems,
    PICTURE_SIZES,
    sizeOfItem,
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
    mode: 'rename' | 'refresh' | 'version';
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

  // Naming a version needs a size: the name's, when it says one, else the owner's pick.
  let size = $state(items[0] ? sizeOfItem(items[0]) : '');
  const version = $derived(mode === 'version' && size !== '' ? { screenSize: size } : undefined);

  let latest = 0;
  async function load(): Promise<void> {
    const ticket = ++latest;
    report = undefined;
    failure = undefined;
    if (mode === 'version' && version === undefined) {
      return;
    }
    try {
      const answer = await libraryItems.preview(libraryId, ids, version);
      // An answer that comes after another choice of size is stale.
      if (ticket === latest) {
        report = answer;
      }
    } catch (error) {
      if (ticket === latest) {
        failure = error;
      }
    }
  }
  void load();

  async function run(): Promise<void> {
    running = true;
    try {
      await libraryItems.run(libraryId, ids, version);
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

  {#if mode === 'version'}
    <label class="size">
      {t('web.library.run.size')}
      <select
        bind:value={size}
        onchange={() => {
          void load();
        }}
      >
        <option value="" disabled>{t('web.library.run.size.pick')}</option>
        {#each PICTURE_SIZES as option (option)}
          <option value={option}>{option}</option>
        {/each}
      </select>
    </label>
  {/if}

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {:else if mode === 'version' && version === undefined}
    <p class="muted">{t('web.library.run.size.needed')}</p>
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
      disabled={running || report === undefined || failure !== undefined || totals?.failed !== 0}
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
    color: var(--text);
  }

  /* Only the list scrolls: the title, the summary and the buttons stay in view however long it is. */
  dialog[open] {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .table-wrap {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }

  thead th {
    position: sticky;
    top: 0;
    background: var(--surface);
  }

  .actions {
    flex: none;
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 50%);
  }

  .size {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
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
