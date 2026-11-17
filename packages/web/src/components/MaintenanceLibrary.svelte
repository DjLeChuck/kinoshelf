<script lang="ts">
  import type { Snippet } from 'svelte';
  import { describeError } from '@kinoshelf/i18n';
  import { messageOf } from '../lib/errors.js';
  import { formatDate } from '../lib/history.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import type { Library } from '../lib/libraries.js';
  import {
    groupFolders,
    hasWork,
    tallyOf,
    type TidyFile,
    type TidyFolder,
    type TidyRequest,
    type TidySubtitle,
    type TidyTask,
  } from '../lib/maintenance.js';
  import { baseName } from '../lib/paths.js';
  import Link from './Link.svelte';
  import MaintenanceDialog from './MaintenanceDialog.svelte';

  let {
    library,
    task,
    onstart,
  }: {
    library: Library;
    /** The latest tidy-up of this library, in the server's memory. */
    task: TidyTask | undefined;
    /** Starts a task; rejects with what the server answered (a scan in progress, a task already running). */
    onstart: (request: TidyRequest) => Promise<void>;
  } = $props();

  let failure = $state<unknown>(undefined);
  // Between the click and the first answer of the server.
  let starting = $state(false);
  let confirming = $state(false);
  // The owner's choice, until they make one the state of the analysis on show (a report read again
  // after a reload still says whether it counted the `<video>.nfo` files).
  let chosenNfo = $state<boolean | undefined>(undefined);
  let chosenSubtitles = $state<boolean | undefined>(undefined);

  const isMovies = $derived(library.type === 'movie');
  const running = $derived(task?.status === 'running' ? task : undefined);
  const locked = $derived(starting || running !== undefined || library.scanning);
  const report = $derived(task?.status === 'done' && task.dryRun ? task : undefined);
  const result = $derived(task?.status === 'done' && !task.dryRun ? task : undefined);
  const shown = $derived(report ?? result);
  const tally = $derived(shown ? tallyOf(shown) : undefined);
  const nfo = $derived(
    chosenNfo ??
      shown?.files?.items.some(
        ({ kind, reason }) => kind === 'nfo' && reason !== 'nfo-not-requested',
      ) ??
      false,
  );
  // Subtitles are off until asked for: the report on show says whether it read them.
  const subtitles = $derived(chosenSubtitles ?? shown?.subtitles != null);
  // Open while there is something to read or follow (a report, a result, a task, a failure), folded
  // otherwise so a list of libraries stays short; the reader's own choice wins once made.
  let toggled = $state<boolean | undefined>(undefined);
  const foldable = $derived(
    shown !== undefined ||
      running !== undefined ||
      failure !== undefined ||
      task?.status === 'failed' ||
      library.scanning,
  );
  const open = $derived(toggled ?? foldable);
  // What the analysis found or the run did, in one line: shown open, and folded under the name.
  const counts = $derived.by(() => {
    if (!tally) {
      return '';
    }
    if (!hasWork(tally) && tally.failed === 0) {
      return t('web.maintenance.nothing');
    }
    return [
      tally.folders > 0 &&
        t(result ? 'web.maintenance.folders.done' : 'web.maintenance.folders.todo', {
          count: tally.folders,
        }),
      tally.renames > 0 &&
        t(result ? 'web.maintenance.renames.done' : 'web.maintenance.renames.todo', {
          count: tally.renames,
        }),
      tally.removals > 0 &&
        t(result ? 'web.maintenance.removals.done' : 'web.maintenance.removals.todo', {
          count: tally.removals,
        }),
      tally.subtitles > 0 &&
        t(result ? 'web.maintenance.subtitles.done' : 'web.maintenance.subtitles.todo', {
          count: tally.subtitles,
        }),
      tally.failed > 0 && t('web.maintenance.failed', { count: tally.failed }),
    ]
      .filter(Boolean)
      .join(' · ');
  });
  const stamp = $derived(
    result
      ? t('web.maintenance.result', {
          date: formatDate(result.endedAt ?? result.startedAt, locale.value),
        })
      : '',
  );

  // The state of the library at a glance, in the header, whether the panel is open or folded.
  const chip = $derived.by((): { kind: string; label: string } => {
    if (running || starting) {
      return { kind: 'info', label: t('web.maintenance.state.running') };
    }
    if (task?.status === 'failed' || failure !== undefined) {
      return { kind: 'danger', label: t('web.maintenance.state.failed') };
    }
    if (!shown || !tally) {
      return { kind: 'neutral', label: t('web.maintenance.state.new') };
    }
    if (result) {
      return tally.failed > 0
        ? { kind: 'warn', label: t('web.maintenance.state.partial') }
        : { kind: 'ok', label: t('web.maintenance.state.done') };
    }
    return hasWork(tally) || tally.failed > 0
      ? {
          kind: 'warn',
          label: t('web.maintenance.state.todo', {
            count: tally.folders + tally.renames + tally.removals + tally.subtitles,
          }),
        }
      : { kind: 'ok', label: t('web.maintenance.state.clean') };
  });
  const percent = $derived(
    running && running.total > 0 ? Math.round((running.done / running.total) * 100) : undefined,
  );

  async function start(dryRun: boolean, withNfo = nfo, withSubtitles = subtitles): Promise<void> {
    starting = true;
    failure = undefined;
    try {
      await onstart({ library: library.id, dryRun, nfo: withNfo, subtitles: withSubtitles });
    } catch (error) {
      failure = error;
    } finally {
      starting = false;
    }
  }

  function toggleNfo(checked: boolean): void {
    chosenNfo = checked;
    // The report on show would no longer be the one a run does: read it again.
    if (report && !locked) {
      void start(true, checked);
    }
  }

  function toggleSubtitles(checked: boolean): void {
    chosenSubtitles = checked;
    if (report && !locked) {
      void start(true, nfo, checked);
    }
  }

  const todoFolders = $derived((shown?.folders?.items ?? []).filter(isDone));
  const leftFolders = $derived(
    (shown?.folders?.items ?? []).filter(({ status }) => status === 'skipped'),
  );
  const failedFolders = $derived(
    (shown?.folders?.items ?? []).filter(({ status }) => status === 'failed'),
  );
  const doneFiles = $derived(
    (shown?.files?.items ?? []).filter(({ status }) => status === 'would-do' || status === 'done'),
  );
  const failedFiles = $derived(
    (shown?.files?.items ?? []).filter(({ status }) => status === 'failed'),
  );

  const doneSubtitles = $derived(
    (shown?.subtitles?.items ?? []).filter(
      ({ status }) => status === 'would-do' || status === 'done',
    ),
  );
  const failedSubtitles = $derived(
    (shown?.subtitles?.items ?? []).filter(({ status }) => status === 'failed'),
  );
  const subtitleLine = (file: TidySubtitle): string =>
    t('web.maintenance.subtitle.row', {
      name: baseName(file.path),
      destination: baseName(file.destination),
    });

  function isDone({ status }: TidyFolder): boolean {
    return status === 'would-remove' || status === 'removed';
  }

  const fileLine = (file: TidyFile): string =>
    t(`web.maintenance.file.${file.action === 'rename' ? 'rename' : 'remove'}`, {
      name: baseName(file.path),
      counterpart: file.counterpart,
    });
</script>

{#snippet todoRow(folder: TidyFolder)}
  <span class="name" title={folder.path}>{baseName(folder.path)}</span>
  {#if folder.empty}
    <span class="muted">{t('web.maintenance.folder.empty')}</span>
  {:else if folder.twin}
    <span class="muted twin" title={folder.twin}
      >{t('web.maintenance.folder.twin', { twin: baseName(folder.twin) })}</span
    >
  {/if}
  {#if folder.approximate}
    <span class="chip chip-warn">{t('web.maintenance.folder.approximate')}</span>
  {/if}
{/snippet}

{#snippet leftRow(folder: TidyFolder)}
  <span class="name" title={folder.path}>{baseName(folder.path)}</span>
  {#if folder.reason}
    <span class="muted">{t(`web.maintenance.reason.${folder.reason}`)}</span>
  {/if}
{/snippet}

<!-- A show's seasons under the show's name; the folders loose in the library (movies) as a plain list. -->
{#snippet grouped(folders: readonly TidyFolder[], row: Snippet<[TidyFolder]>)}
  <ul class="groups">
    {#each groupFolders(folders, library.source) as group (group.parent)}
      <li>
        {#if group.parent}<span class="show">{group.parent}</span>{/if}
        <ul class="rows">
          {#each group.folders as folder (folder.path)}
            <li>{@render row(folder)}</li>
          {/each}
        </ul>
      </li>
    {/each}
  </ul>
{/snippet}

<article class="card" aria-labelledby={`maintenance-${library.id}`}>
  <header>
    <div>
      <h3 id={`maintenance-${library.id}`}>
        {library.name}
        <span class={`chip chip-${chip.kind}`}>{chip.label}</span>
      </h3>
      <p class="muted mono source">{library.source}</p>
    </div>
    <div class="actions">
      <!-- Only when there is something to fold: a library never analysed has nothing behind it. -->
      {#if foldable}
        <button
          type="button"
          class="btn fold"
          aria-expanded={open}
          aria-controls={`maintenance-body-${library.id}`}
          onclick={() => {
            toggled = !open;
          }}
        >
          {open ? t('web.maintenance.panel.hide') : t('web.maintenance.panel.show')}
        </button>
      {/if}
      <button type="button" class="btn" disabled={locked} onclick={() => void start(true)}>
        {#if running?.dryRun || starting}
          {t('web.maintenance.analysing')}
        {:else}
          {report || result ? t('web.maintenance.analyse.again') : t('web.maintenance.analyse')}
        {/if}
      </button>
    </div>
  </header>

  {#if !open && shown && tally}
    <p class="muted folded">{stamp} {counts}</p>
  {/if}

  {#if isMovies}
    <label class="check">
      <input
        type="checkbox"
        checked={nfo}
        disabled={locked}
        onchange={(event) => {
          toggleNfo(event.currentTarget.checked);
        }}
      />
      <span>
        {t('web.maintenance.nfo')}
        <span class="muted hint">{t('web.maintenance.nfo.hint')}</span>
      </span>
    </label>
  {/if}

  <label class="check">
    <input
      type="checkbox"
      checked={subtitles}
      disabled={locked}
      onchange={(event) => {
        toggleSubtitles(event.currentTarget.checked);
      }}
    />
    <span>
      {t('web.maintenance.subtitles')}
      <span class="muted hint">{t('web.maintenance.subtitles.hint')}</span>
    </span>
  </label>

  <div class="body" id={`maintenance-body-${library.id}`} hidden={!open}>
    {#if library.scanning}
      <p class="muted" role="status">{t('web.maintenance.scanning')}</p>
    {/if}
    {#if failure}
      <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
    {/if}
    {#if task?.status === 'failed' && task.error}
      <p class="alert alert-danger" role="alert">{describeError(t, task.error)}</p>
    {/if}

    {#if running}
      <div class="running" role="status" aria-live="polite">
        {#if percent === undefined}
          <progress aria-label={t('web.maintenance.progress.label')}></progress>
        {:else}
          <progress max="100" value={percent} aria-label={t('web.maintenance.progress.label')}
            >{percent}%</progress
          >
        {/if}
        <p class="muted">
          {#if running.phase === 'reading'}
            {t('web.maintenance.progress.reading')}
          {:else}
            {t(`web.maintenance.progress.${running.phase}`, {
              done: running.done,
              total: running.total,
            })}
          {/if}
        </p>
        {#if running.current}<p class="muted mono current">{running.current}</p>{/if}
      </div>
    {/if}

    {#if shown && tally}
      <section aria-live="polite" aria-label={t('web.maintenance.report')}>
        <p class="summary">
          {#if stamp}<b class="stamp">{stamp}</b>{/if}
          {counts}
        </p>

        {#if todoFolders.length > 0}
          <details open={todoFolders.length <= 12}>
            <summary>
              {t(result ? 'web.maintenance.folders.done' : 'web.maintenance.folders.todo', {
                count: todoFolders.length,
              })}
            </summary>
            {#if tally.approximate > 0}
              <p class="muted hint">
                {t('web.maintenance.approximate.hint', { count: tally.approximate })}
              </p>
            {/if}
            {@render grouped(todoFolders, todoRow)}
          </details>
        {/if}

        {#if leftFolders.length > 0}
          <details>
            <summary>{t('web.maintenance.left', { count: leftFolders.length })}</summary>
            {@render grouped(leftFolders, leftRow)}
          </details>
        {/if}

        {#if doneFiles.length > 0}
          <details open={doneFiles.length <= 12}>
            <summary>
              {t(result ? 'web.maintenance.files.done' : 'web.maintenance.files.todo', {
                count: doneFiles.length,
              })}
            </summary>
            <ul class="rows">
              {#each doneFiles as file (file.path)}
                <li><span class="name" title={file.path}>{fileLine(file)}</span></li>
              {/each}
            </ul>
          </details>
        {/if}

        {#if doneSubtitles.length > 0}
          <details open={doneSubtitles.length <= 12}>
            <summary>
              {t(result ? 'web.maintenance.subtitles.done' : 'web.maintenance.subtitles.todo', {
                count: doneSubtitles.length,
              })}
            </summary>
            <ul class="rows">
              {#each doneSubtitles as file (file.path)}
                <li><span class="name" title={file.path}>{subtitleLine(file)}</span></li>
              {/each}
            </ul>
          </details>
        {/if}

        {#if (shown.subtitles?.left.length ?? 0) > 0}
          <details>
            <summary>
              {t('web.maintenance.subtitles.left', { count: shown.subtitles?.left.length ?? 0 })}
            </summary>
            <ul class="rows">
              {#each shown.subtitles?.left ?? [] as file (file.path + file.reason)}
                <li>
                  <span class="name" title={file.path}>{baseName(file.path)}</span>
                  <span class="muted">{t(`web.library.run.left.${file.reason}`)}</span>
                </li>
              {/each}
            </ul>
          </details>
        {/if}

        {#if tally.nfoLeft > 0 && !nfo}
          <p class="muted hint">{t('web.maintenance.nfo.left', { count: tally.nfoLeft })}</p>
        {/if}

        {#if failedFolders.length + failedFiles.length + failedSubtitles.length > 0}
          <details open>
            <summary
              >{t('web.maintenance.failed', {
                count: failedFolders.length + failedFiles.length + failedSubtitles.length,
              })}</summary
            >
            <ul class="rows">
              {#each [...failedFolders, ...failedFiles, ...failedSubtitles] as item (item.path)}
                <li>
                  <span class="name" title={item.path}>{baseName(item.path)}</span>
                  {#if item.error}
                    <span class="muted">{describeError(t, item.error)}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          </details>
        {/if}

        {#if result}
          <p class="batches">
            {#each [result.folders?.batch, result.files?.batch, result.subtitles?.batch].filter((id): id is string => id != null) as batch (batch)}
              <Link href={`/history/${batch}`}>{t('web.maintenance.batch.link')}</Link>
            {/each}
          </p>
          <p class="muted hint">{t('web.maintenance.batch.hint')}</p>
        {/if}
      </section>
    {/if}

    {#if report && tally && hasWork(tally)}
      <footer>
        <button
          type="button"
          class="btn btn-primary"
          disabled={locked}
          onclick={() => {
            confirming = true;
          }}
        >
          {t('web.maintenance.run')}
        </button>
      </footer>
    {/if}
  </div>
</article>

{#if confirming && tally}
  <MaintenanceDialog
    name={library.name}
    {tally}
    onclose={() => {
      confirming = false;
    }}
    onconfirm={() => void start(false)}
  />
{/if}

<style>
  article {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  /* The name and path keep a readable width: the buttons go under them on a phone. */
  header > div:first-child {
    flex: 1 1 220px;
    min-width: 0;
  }

  .actions {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .body[hidden] {
    display: none;
  }

  h3 {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    margin: 0;
    font-size: 16px;
  }

  p {
    margin: 0;
  }

  .source {
    overflow-wrap: anywhere;
    font-size: 12.5px;
  }

  .running {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .running progress {
    width: 100%;
  }

  .current {
    overflow-wrap: anywhere;
  }

  .check {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-height: 44px;
    cursor: pointer;
  }

  .check input {
    flex: none;
    width: 18px;
    height: 18px;
    margin: 2px 0 0;
    accent-color: var(--accent);
  }

  .hint {
    display: block;
    font-size: 12.5px;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  summary {
    min-height: 32px;
    cursor: pointer;
    font-weight: 600;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
  }

  .rows li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
  }

  .stamp {
    margin-right: 0.4em;
  }

  .groups {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
  }

  .show {
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .groups .rows {
    margin-top: 2px;
    padding-left: 16px;
  }

  progress {
    accent-color: var(--accent);
  }

  .name {
    overflow-wrap: anywhere;
  }

  .batches {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
</style>
