<script lang="ts">
  import { onDestroy } from 'svelte';
  import { describeError } from '@kinoshelf/i18n';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { onTopics, refetchOn } from '../lib/events.svelte.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import {
    STATUS_CHIP,
    canUndo,
    formatDate,
    originOf,
    shortId,
    tally,
    type BatchDetail,
    type BatchExtra,
    type BatchItem,
    type UndoProgress,
    type UndoReport,
  } from '../lib/history.js';
  import JobDetail from './JobDetail.svelte';
  import { baseName } from '../lib/paths.js';
  import { workOf, type ChangeRow, type ChipTone } from '../lib/change-list.js';
  import ChangeList from './ChangeList.svelte';
  import type { ErrorBody } from '../lib/arrivals.js';

  let {
    id,
    ondone,
  }: {
    id: string;
    /** The batch was undone: what to tell the user. */
    ondone: (message: string) => void;
  } = $props();

  let batch = $state<BatchDetail | undefined>(undefined);
  let failure = $state<unknown>(undefined);
  let preview = $state<UndoReport | undefined>(undefined);
  let busy = $state(false);
  // Read apart from the batch, which lists every file: this is a few numbers held in memory.
  let running = $state<UndoProgress | null>(null);
  // Also locked when the undo was started elsewhere (another tab, before a reload): the server refuses a second one.
  const locked = $derived(busy || running?.dryRun === false);
  const percent = $derived(
    running && running.total > 0 ? Math.round((running.done / running.total) * 100) : undefined,
  );

  // The parent keys this component on the batch, so `id` does not change during its life.
  refetchOn(['history', 'ready'], () => void load());

  async function loadProgress(): Promise<void> {
    try {
      running = (await api.get<{ progress: UndoProgress | null }>(`/api/batches/${id}/undo`))
        .progress;
    } catch {
      // The numbers are a courtesy: the request itself says how it ended.
    }
  }

  // Only while an undo is going on (here, or started from another tab and found on arrival), so
  // the scans' events do not make every open batch ask.
  const stopProgress = onTopics(['progress', 'ready'], () => {
    if (busy || running) {
      void loadProgress();
    }
  });
  onDestroy(stopProgress);
  void loadProgress();

  async function load(): Promise<void> {
    try {
      batch = await api.get<BatchDetail>(`/api/batches/${id}`);
      failure = undefined;
    } catch (error) {
      failure = error;
    }
  }

  // A failure the server stored (the job's, a file's) is a code and its parameters, not a thrown
  // ApiError: `messageOf` would only say something went wrong.
  const describe = (error: ErrorBody): string => describeError(t, error);

  const ITEM_TONE: Record<BatchItem['status'], ChipTone> = {
    done: 'ok',
    undone: 'neutral',
    failed: 'danger',
  };

  // One line per file, folded under the movie or the show it belongs to; what Kinoshelf wrote
  // beside the videos (NFO, images) joins the same fold instead of a list of its own.
  function itemRow(item: BatchItem, several: boolean): ChangeRow {
    const work = workOf(item.destination ?? item.source);
    const before = baseName(item.source);
    const after = item.destination === null ? undefined : baseName(item.destination);
    const renamed = after !== undefined && after !== before;
    return {
      id: `${item.source}->${item.destination}`,
      group: work.key,
      groupLabel: work.name,
      ...(renamed
        ? {
            before,
            after,
            beforeTitle: `${t('web.history.from')}: ${item.source}`,
            afterTitle: `${t('web.history.to')}: ${item.destination}`,
          }
        : { title: before }),
      chips: [
        ...(item.status === 'done'
          ? []
          : [{ text: t(`web.history.item.${item.status}`), tone: ITEM_TONE[item.status] }]),
        ...(several
          ? [{ text: t(`web.settings.processing.mode.${item.mode}`), tone: 'neutral' as const }]
          : []),
      ],
      ...(item.error && { note: describe(item.error) }),
      problem: item.status === 'failed',
      detailCount: 0,
    };
  }

  function extraRow(extra: BatchExtra): ChangeRow {
    const work = workOf(extra.destination);
    return {
      id: `extra:${extra.destination}`,
      group: work.key,
      groupLabel: work.name,
      after: baseName(extra.destination),
      afterTitle: extra.destination,
      chips: [{ text: t(`web.history.extra.${extra.kind}`), tone: 'neutral' }],
      problem: false,
      detailCount: 0,
    };
  }

  const rows = $derived<ChangeRow[]>(
    batch === undefined
      ? []
      : [
          ...batch.items.map((item) => itemRow(item, batch?.modes.length !== 1)),
          ...batch.extras.map(extraRow),
        ],
  );

  const UNDO_TONE = { undone: 'ok', skipped: 'warn', failed: 'danger' } as const;
  const undoRows = $derived<ChangeRow[]>(
    (preview?.entries ?? []).map((entry) => {
      const work = workOf(entry.destination);
      return {
        id: entry.destination,
        group: work.key,
        groupLabel: work.name,
        title: baseName(entry.destination),
        chips: [{ text: t(`web.history.undo.${entry.status}`), tone: UNDO_TONE[entry.status] }],
        ...(entry.error && { note: describe(entry.error) }),
        problem: entry.status !== 'undone',
        detailCount: 0,
      };
    }),
  );

  const outcome = $derived({
    done: batch?.items.filter(({ status }) => status === 'done').length ?? 0,
    failed: batch?.items.filter(({ status }) => status === 'failed').length ?? 0,
  });
  const extrasSummary = $derived(
    (['generated', 'downloaded', 'replaced'] as const)
      .map((kind) => ({ kind, count: batch?.extras.filter((e) => e.kind === kind).length ?? 0 }))
      .filter(({ count }) => count > 0)
      .map(({ kind, count }) => t(`web.history.extras.count.${kind}`, { count }))
      .join(' · '),
  );

  async function check(): Promise<void> {
    busy = true;
    failure = undefined;
    try {
      preview = await api.post<UndoReport>(`/api/batches/${id}/undo`, { dryRun: true });
    } catch (error) {
      failure = error;
    } finally {
      busy = false;
      running = null;
    }
  }

  async function confirm(): Promise<void> {
    busy = true;
    failure = undefined;
    try {
      const report = await api.post<UndoReport>(`/api/batches/${id}/undo`, { dryRun: false });
      preview = undefined;
      ondone(t('web.history.undo.result', tally(report)));
      await load();
    } catch (error) {
      failure = error;
    } finally {
      busy = false;
      running = null;
    }
  }
</script>

{#if failure && !batch}
  <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
{:else if batch}
  <article class="card">
    <header>
      <div>
        <h2>{formatDate(batch.at, locale.value)}</h2>
        {#if originOf(batch)}
          <p class="muted">
            {t('web.history.submitted')}: <span class="mono">{originOf(batch)}</span>
          </p>
        {:else}
          <p class="muted">{t('web.history.origin.cli')}</p>
        {/if}
      </div>
      <span class="chip {STATUS_CHIP[batch.status]}">{t(`web.history.status.${batch.status}`)}</span
      >
    </header>

    {#if batch.error}
      <p class="alert alert-danger">{describe(batch.error)}</p>
    {/if}

    <section aria-labelledby="items-title">
      <h3 id="items-title">{t('web.history.items')}</h3>
      <p class="muted summary">
        {t('web.history.files', { count: batch.items.length })}
        {#if batch.items.length > 0}
          · {t('web.history.done-files', { count: outcome.done })}
          {#if outcome.failed > 0}· {t('web.history.failed-files', { count: outcome.failed })}{/if}
        {/if}
        {#if extrasSummary}
          <br />{extrasSummary}
        {/if}
      </p>
      {#if rows.length > 0}
        <ChangeList {rows} />
        {#if batch.extras.length > 0}
          <p class="muted hint">{t('web.history.extras.hint')}</p>
        {/if}
      {/if}
    </section>
    {#if batch.origin}
      <details>
        <summary>{t('web.history.job.title', { id: shortId(batch.origin.jobId) })}</summary>
        <JobDetail id={batch.origin.jobId} embedded />
      </details>
    {/if}

    {#if preview}
      <section aria-labelledby="undo-title" aria-live="polite">
        <h3 id="undo-title">{t('web.history.undo.preview')}</h3>
        <p class="muted">{t('web.history.undo.hint')}</p>
        <ChangeList rows={undoRows} />
      </section>
    {/if}

    {#if failure}
      <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
    {/if}

    {#if batch.status === 'failed'}
      <p class="muted">{t('web.history.nothing-to-undo')}</p>
    {:else if batch.status === 'undone'}
      <p class="muted">{t('web.history.already-undone')}</p>
    {:else if canUndo(batch)}
      {#if running}
        <div class="running" role="status" aria-live="polite">
          {#if percent === undefined}
            <progress aria-label={t('web.history.undo.progress.label')}></progress>
          {:else}
            <progress max="100" value={percent} aria-label={t('web.history.undo.progress.label')}
              >{percent}%</progress
            >
          {/if}
          <p class="muted">
            {#if running.total > 0 && running.done >= running.total}
              {t('web.history.undo.progress.finishing')}
            {:else}
              {t(`web.history.undo.progress.${running.dryRun ? 'checking' : 'running'}`, {
                done: running.done,
                total: running.total,
              })}
            {/if}
          </p>
          {#if running.current}<p class="muted mono current">{running.current}</p>{/if}
        </div>
      {/if}
      <footer>
        {#if preview}
          <button
            type="button"
            class="btn btn-primary"
            disabled={locked}
            onclick={() => void confirm()}
          >
            {locked ? t('web.history.undo.running') : t('web.history.undo.confirm')}
          </button>
          <button type="button" class="btn" disabled={locked} onclick={() => (preview = undefined)}>
            {t('web.history.undo.cancel')}
          </button>
        {:else}
          <button type="button" class="btn" disabled={locked} onclick={() => void check()}>
            {busy ? t('web.history.undo.checking') : t('web.history.undo')}
          </button>
        {/if}
      </footer>
    {/if}
  </article>
{:else}
  <p class="muted" role="status">{t('web.loading')}</p>
{/if}

<style>
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  h2 {
    font-size: 16px;
  }

  h3 {
    margin-bottom: 8px;
    font-size: 13px;
    color: var(--muted);
    font-weight: 600;
  }

  .summary,
  .hint {
    margin: 0 0 8px;
  }

  summary {
    cursor: pointer;
    color: var(--muted);
    font-weight: 600;
  }

  details[open] summary {
    margin-bottom: 8px;
  }

  .running {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
  }

  .running p {
    margin: 0;
  }

  .running progress {
    width: 100%;
  }

  .current {
    overflow-wrap: anywhere;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
</style>
