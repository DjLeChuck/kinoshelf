<script lang="ts">
  import { baseName } from '../lib/paths.js';
  import { describeError } from '@kinoshelf/i18n';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import { libraryKey, runs } from '../lib/validations.svelte.js';
  import {
    libraryItems,
    PICTURE_SIZES,
    sizeOfItem,
    tally,
    type LibraryItem,
    type ReportOperation,
    type RunReport,
    type VersionRequest,
  } from '../lib/library-items.js';
  import { previewOf, type PreviewFile, type PreviewItem } from '../lib/run-preview.js';
  import type { ChangeRow } from '../lib/change-list.js';
  import ChangeList from './ChangeList.svelte';

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

  // Naming a version: the size is the name's, when it says one (the menu starts there), else the
  // server reads it from the file; picking one overrides both. It only starts from the item's (the
  // dialog is mounted for one selection); the menu then owns it.
  /* svelte-ignore state_referenced_locally */
  let size = $state(items[0] ? sizeOfItem(items[0]) : '');
  const version = $derived<VersionRequest | undefined>(
    mode !== 'version' ? undefined : size === '' ? {} : { screenSize: size },
  );

  let latest = 0;
  async function load(): Promise<void> {
    const ticket = ++latest;
    report = undefined;
    failure = undefined;
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
    // Marked from the click, in the list too: the server's `transfer` only shows after a reload.
    const keys = [libraryKey(libraryId), ...ids];
    for (const key of keys) {
      runs.start(key);
    }
    try {
      await libraryItems.run(libraryId, ids, version);
      ondone(t('web.library.run.started'));
    } catch (error) {
      failure = error;
      running = false;
    } finally {
      for (const key of keys) {
        runs.clear(key);
      }
    }
  }

  const byEntry = $derived(new Map(items.map((item) => [item.entryId, item])));
  const totals = $derived(report ? tally(report) : undefined);
  const preview = $derived(report ? previewOf(report) : undefined);
  const nameOf = (item: LibraryItem | undefined, fallback: string): string =>
    item?.title ?? (item ? baseName(item.path) : fallback);
  const blocked = (operation: ReportOperation): string | undefined =>
    operation.error ? describeError(t, operation.error) : undefined;

  const seasonTag = (item: LibraryItem): string | undefined =>
    item.season === null || item.episode === null
      ? undefined
      : `S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}${
          item.episodeEnd !== null && item.episodeEnd !== item.episode
            ? `-E${String(item.episodeEnd).padStart(2, '0')}`
            : ''
        }`;

  // A show's episodes fold under the show, a movie is a line of its own.
  function rowOf(entry: PreviewItem): ChangeRow {
    const item = byEntry.get(entry.entryId);
    const files = entry.folders.flatMap(({ moved }) => moved);
    const main = files.find(({ operation }) => operation.role !== 'sidecar');
    const failure = entry.folders
      .flatMap(({ moved, written }) => [...moved, ...written])
      .find(({ operation }) => operation.status === 'failed')?.operation;
    const note = failure === undefined ? undefined : blocked(failure);
    const title = nameOf(item, entry.entryId);
    const tag = item ? seasonTag(item) : undefined;
    const show = item?.kind === 'series' && item.tmdbId !== null && tag !== undefined;
    const source = main?.operation.source ?? undefined;
    const renamed =
      source !== undefined &&
      main !== undefined &&
      baseName(source) !== baseName(main.operation.destination);
    return {
      id: entry.entryId,
      group: show ? `series:${item.tmdbId}` : entry.entryId,
      groupLabel: title,
      ...(tag !== undefined && { tag }),
      ...(!show && { title }),
      ...(renamed && {
        before: baseName(source),
        after: baseName(main.operation.destination),
        beforeTitle: source,
        afterTitle: main.operation.destination,
      }),
      chips: entry.failed ? [{ text: t('web.library.run.blocked'), tone: 'danger' }] : [],
      ...(note !== undefined && { note }),
      problem: entry.failed,
      detailCount: entry.count - (main === undefined ? 0 : 1),
    };
  }
  const rows = $derived((preview?.items ?? []).map(rowOf));
  const previewById = $derived(new Map((preview?.items ?? []).map((item) => [item.entryId, item])));
</script>

{#snippet status(file: PreviewFile)}
  {#if file.operation.status === 'skipped'}
    <span class="chip chip-neutral">{t('web.library.run.exists')}</span>
  {:else if file.operation.status === 'failed'}
    <span class="chip chip-danger" title={blocked(file.operation)}
      >{t('web.library.run.blocked')}</span
    >
  {/if}
{/snippet}

{#snippet folders(item: PreviewItem)}
  <div class="folders">
    {#each item.folders as folder (folder.path)}
      <p class="mono folder">{folder.path}/</p>
      <ul class="files">
        {#each folder.moved as file (file.name)}
          <li>
            <span class="tag">
              {t(
                file.operation.role === 'sidecar'
                  ? 'web.library.run.tag.sidecar'
                  : 'web.library.run.tag.main',
              )}
            </span>
            <span class="mono" title={file.name}>{file.short}</span>
            {@render status(file)}
          </li>
        {/each}
        {#if folder.written.length > 0}
          <li>
            <span class="tag">{t('web.library.run.tag.written')}</span>
            <span class="written">
              {#each folder.written as file (file.name)}
                <span class="mono token" title={file.name}>{file.short}</span>
                {@render status(file)}
              {/each}
            </span>
          </li>
        {/if}
      </ul>
    {/each}
  </div>
{/snippet}

<dialog
  bind:this={dialog}
  class="card"
  class:compact={mode === 'version'}
  aria-labelledby="run-title"
  {onclose}
  oncancel={(event) => {
    // Esc must not close what is being sent: the answer would go to nobody.
    if (running) {
      event.preventDefault();
    }
  }}
>
  <h2 id="run-title">{t(`web.library.run.title.${mode}`)}</h2>

  {#if mode === 'version'}
    <div class="field size">
      <label for="version-size">{t('web.library.run.size')}</label>
      <select
        id="version-size"
        class="input"
        bind:value={size}
        onchange={() => {
          void load();
        }}
      >
        <option value="">{t('web.library.run.size.auto')}</option>
        {#each PICTURE_SIZES as option (option)}
          <option value={option}>{option}</option>
        {/each}
      </select>
    </div>
  {/if}

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {:else if report === undefined || totals === undefined}
    <p class="muted" role="status">{t('web.loading')}</p>
  {:else}
    <p class="muted">{t('web.library.run.summary', totals)}</p>
    {#if report.skipped.length > 0}
      <p class="muted">{t('web.library.run.skipped', { count: report.skipped.length })}</p>
    {/if}
    <div class="list">
      <ChangeList {rows}>
        {#snippet lead()}
          <p class="muted root">{t('web.library.run.root', { path: preview?.root ?? '' })}</p>
        {/snippet}
        {#snippet detail(row: ChangeRow)}
          {@const item = previewById.get(row.id)}
          {#if item}
            {@render folders(item)}
          {/if}
        {/snippet}
      </ChangeList>
    </div>
  {/if}

  <div class="actions">
    <button type="button" class="btn" disabled={running} onclick={() => dialog?.close()}>
      {t('web.library.run.cancel')}
    </button>
    <button
      type="button"
      class="btn btn-primary"
      disabled={running || report === undefined || failure !== undefined || totals?.failed !== 0}
      onclick={() => void run()}
    >
      {running ? t('web.library.run.running') : t('web.library.run.confirm')}
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

  .list {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }

  .actions {
    flex: none;
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 50%);
  }

  /* One line to show, not a list: the dialog need not be as wide as for a selection. */
  dialog.compact {
    width: min(640px, 94vw);
  }

  .size {
    max-width: 240px;
    margin-bottom: 12px;
  }

  h2 {
    font-size: 18px;
    margin: 0 0 8px;
  }

  p {
    margin: 0 0 8px;
  }

  .root {
    margin: 0;
    font-size: 12.5px;
  }

  .folders {
    margin-top: 6px;
    min-width: 0;
  }

  .folder {
    margin: 4px 0 2px;
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .files {
    list-style: none;
    margin: 0 0 0 10px;
    padding: 0 0 0 12px;
    border-left: 2px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .files li {
    display: flex;
    gap: 8px;
    align-items: baseline;
    min-width: 0;
  }

  .files .mono {
    font-size: 11.5px;
    overflow-wrap: anywhere;
  }

  .tag {
    flex: none;
    width: 4.5em;
    color: var(--muted);
    font-size: 11px;
  }

  .written {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    align-items: baseline;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
