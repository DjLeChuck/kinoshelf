<script lang="ts">
  import { describeError } from '@kinoshelf/i18n';
  import Link from '../components/Link.svelte';
  import { messageOf } from '../lib/errors.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { t } from '../lib/i18n.svelte.js';
  import type { JobDetail } from '../lib/job.js';
  import { api } from '../lib/api.js';
  import {
    SCAN_TABS,
    countTotal,
    libraryApi,
    libraryPath,
    type Library,
    type ScanCounts,
    type ScanRow,
    type ScanTab,
  } from '../lib/libraries.js';
  import { profileName, type Settings } from '../lib/settings.js';
  import {
    isSelected,
    scoreLabel,
    scoreTone,
    selectedIds,
    toggleAll,
    toggleRow,
  } from '../lib/scan.js';

  const PAGE = 200;

  let { libraryId, jobId }: { libraryId: string; jobId: string } = $props();

  let job = $state<JobDetail | undefined>(undefined);
  let library = $state<Library | undefined>(undefined);
  let profiles = $state<Settings['profiles']>([]);
  let counts = $state<ScanCounts | undefined>(undefined);
  let tab = $state<ScanTab>('rename');
  let rows = $state<readonly ScanRow[]>([]);
  let off = $state<ReadonlySet<string>>(new Set());
  let failure = $state<unknown>(undefined);
  let actionFailure = $state<unknown>(undefined);
  let notice = $state<string | undefined>(undefined);
  let busy = $state(false);

  const shownTabs = $derived(
    SCAN_TABS.filter((name) => name !== 'conflict' || (counts?.conflict ?? 0) > 0 || tab === name),
  );
  const selectable = $derived(tab === 'rename');
  let total = $state(0);
  const selectedCount = $derived(selectable ? total - off.size : 0);

  async function loadRows(append: boolean): Promise<void> {
    const page = await libraryApi.files(jobId, tab, append ? rows.length : 0, PAGE);
    counts = page.counts;
    rows = append ? [...rows, ...page.rows] : page.rows;
    total = page.total;
  }

  async function load(): Promise<void> {
    try {
      job = await api.get<JobDetail>(`/api/jobs/${jobId}`);
      if (!library || profiles.length === 0) {
        const [list, settings] = await Promise.all([
          libraryApi.list(),
          api.get<Settings>('/api/settings'),
        ]);
        library = list.find(({ id }) => id === libraryId);
        profiles = settings.profiles;
      }
      if (job.status === 'done') {
        await loadRows(false);
      }
      failure = undefined;
    } catch (error) {
      failure = error;
    }
  }

  refetchOn(['jobs', 'queue', 'ready'], () => void load());

  async function pick(next: ScanTab): Promise<void> {
    tab = next;
    notice = undefined;
    rows = [];
    try {
      await loadRows(false);
    } catch (error) {
      failure = error;
    }
  }

  /** Left and right move between the tabs, as in the WAI-ARIA pattern. */
  function onTabKey(event: KeyboardEvent): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const next = shownTabs[(shownTabs.indexOf(tab) + step + shownTabs.length) % shownTabs.length];
    if (next) {
      void pick(next);
      document.getElementById(`scan-tab-${next}`)?.focus();
    }
  }

  async function run(dryRun: boolean): Promise<void> {
    busy = true;
    actionFailure = undefined;
    notice = undefined;
    try {
      // The deselection is by id, so the ids of the rows not shown yet have to be known.
      while (rows.length < total) {
        await loadRows(true);
      }
      const entries = selectedIds(rows, off);
      const { blocked } = await libraryApi.execute(jobId, { entries, dryRun });
      notice =
        t(dryRun ? 'web.scan.dry.done' : 'web.scan.run.done', { count: entries.length }) +
        (blocked > 0 ? t('web.scan.dry.blocked', { count: blocked }) : '');
      if (!dryRun) {
        off = new Set();
        await load();
      }
    } catch (error) {
      actionFailure = error;
    } finally {
      busy = false;
    }
  }

  /** The path under the scanned folder, which is all that tells two files apart. */
  const shown = (path: string): string =>
    job && path.startsWith(`${job.path.replace(/\/+$/, '')}/`)
      ? path.slice(job.path.replace(/\/+$/, '').length + 1)
      : path;
  const describe = (): string =>
    job?.error ? describeError(t, { code: job.error.code, params: job.error.params }) : '';
  const profileLabel = $derived.by(() => {
    const id = job?.settings?.profile;
    const bundled = profiles.find((profile) => profile.id === id);
    return bundled ? profileName(bundled, t) : (id ?? '');
  });
</script>

<div class="page">
  <nav aria-label={t('web.scan.crumb')} class="muted crumb">
    <Link href="/libraries">{t('web.nav.libraries')}</Link>
    <span aria-hidden="true">›</span>
    <Link href={libraryPath(libraryId)}>{library?.name ?? '…'}</Link>
  </nav>

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {:else if job === undefined}
    <p class="muted" role="status">{t('web.loading')}</p>
  {:else}
    <header class="head">
      <h1>{t('web.scan.title')}</h1>
      <p class="muted">
        <span class="mono">{job.path}</span>
        {#if counts}
          · {t('web.scan.meta', {
            count: countTotal(counts),
            profile: profileLabel,
            mode: job.settings ? t(`web.settings.processing.mode.${job.settings.mode}`) : '',
          })}
        {/if}
      </p>
    </header>

    {#if job.status === 'failed'}
      <p class="alert alert-danger" role="alert">
        {describe()}
        <Link href={`/jobs/${job.id}`}>{t('web.history.failed.job')}</Link>
      </p>
    {:else if job.status !== 'done' || counts === undefined}
      <p class="muted" role="status">{t('web.scan.running')}</p>
    {:else}
      <div class="tabs" role="tablist" aria-label={t('web.scan.tabs')}>
        {#each shownTabs as name (name)}
          <button
            type="button"
            role="tab"
            id="scan-tab-{name}"
            class="tab tab-{name}"
            aria-selected={tab === name}
            aria-controls="scan-panel"
            tabindex={tab === name ? 0 : -1}
            onclick={() => void pick(name)}
            onkeydown={onTabKey}
          >
            <span class="dot" aria-hidden="true"></span>
            <span class="count mono">{counts[name]}</span>
            <span class="label">{t(`web.scan.tab.${name}`)}</span>
          </button>
        {/each}
      </div>
      <p class="muted help">{t(`web.scan.help.${tab}`)}</p>

      <div id="scan-panel" role="tabpanel" aria-labelledby="scan-tab-{tab}" class="panel">
        {#if rows.length === 0}
          <p class="muted">{t('web.scan.empty')}</p>
        {:else}
          <div class="table" role="table">
            <div class="row header" role="row">
              <span role="columnheader" class="pick">
                {#if selectable}
                  <input
                    type="checkbox"
                    aria-label={t('web.scan.select-all')}
                    checked={off.size === 0}
                    onchange={() => {
                      off = toggleAll(off, rows);
                    }}
                  />
                {/if}
              </span>
              <span role="columnheader">{t('web.scan.col.from')}</span>
              <span role="columnheader" class="to">{t('web.scan.col.to')}</span>
              <span role="columnheader" class="score">{t('web.scan.col.score')}</span>
            </div>
            {#each rows as row (row.id)}
              <div class="row" role="row">
                <span role="cell" class="pick">
                  <input
                    type="checkbox"
                    aria-label={t('web.scan.row.select', { file: shown(row.from) })}
                    checked={selectable && isSelected(off, row.id)}
                    disabled={!selectable}
                    onchange={() => {
                      off = toggleRow(off, row.id);
                    }}
                  />
                </span>
                <span role="cell" class="mono from">{shown(row.from)}</span>
                <span role="cell" class="mono to" class:muted={!selectable}
                  >{row.to ?? t(`web.scan.to.${tab}` as 'web.scan.to.ambiguous')}</span
                >
                <span role="cell" class="mono score tone-{scoreTone(row.score)}"
                  >{scoreLabel(row.score) ?? '—'}</span
                >
              </div>
            {/each}
          </div>
          {#if rows.length < total}
            <button type="button" class="btn more" onclick={() => void loadRows(true)}
              >{t('web.job.files.more')}</button
            >
          {/if}
        {/if}
      </div>

      <div class="bar">
        <div class="status">
          <span class="selection"
            >{selectable
              ? t('web.scan.selected', { count: selectedCount })
              : t('web.scan.selected.none')}</span
          >
          {#if notice}<span class="ok" role="status">{notice}</span>{/if}
          {#if actionFailure}
            <span class="bad" role="alert">{messageOf(t, actionFailure)}</span>
          {/if}
        </div>
        <div class="buttons">
          <button
            type="button"
            class="btn"
            disabled={busy || !selectable || selectedCount === 0}
            onclick={() => void run(true)}>{t('web.scan.dry')}</button
          >
          <button
            type="button"
            class="btn btn-primary"
            disabled={busy || !selectable || selectedCount === 0}
            onclick={() => void run(false)}>{t('web.scan.run')}</button
          >
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .crumb {
    display: flex;
    gap: 8px;
    font-size: 13px;
  }

  h1 {
    font-size: 22px;
    margin-bottom: 4px;
  }

  .tabs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 8px;
  }

  .tab {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-height: 44px;
    padding: 12px 14px;
    border: 2px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    text-align: left;
    cursor: pointer;
  }

  .tab[aria-selected='true'] {
    border-color: var(--accent);
  }

  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    margin-top: 8px;
    border-radius: 50%;
    background: var(--muted);
  }

  .tab-rename .dot {
    background: var(--warn);
  }

  .tab-ambiguous .dot {
    background: var(--info);
  }

  .tab-unrecognized .dot,
  .tab-conflict .dot {
    background: var(--danger);
  }

  .tab-compliant .dot {
    background: var(--ok);
  }

  .count {
    display: block;
    font-size: 22px;
    font-weight: 700;
  }

  .tab {
    flex-wrap: wrap;
  }

  .label {
    color: var(--muted);
    font-size: 13px;
  }

  .help {
    margin: 0;
  }

  .table {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
  }

  .row {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) minmax(0, 1.4fr) 72px;
    gap: 12px;
    align-items: center;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    font-size: 12.5px;
  }

  .row.header {
    border-top: 0;
    color: var(--muted);
    font-size: 12px;
    background: var(--surface-2);
  }

  .row > span {
    overflow-wrap: anywhere;
  }

  .pick input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }

  .score {
    text-align: right;
  }

  .tone-ok {
    color: var(--ok);
  }

  .tone-warn {
    color: var(--warn);
  }

  .tone-muted {
    color: var(--muted);
  }

  .more {
    align-self: center;
    margin-top: 12px;
  }

  .panel {
    display: flex;
    flex-direction: column;
  }

  .bar {
    position: sticky;
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 16px;
  }

  .selection {
    font-weight: 600;
  }

  .ok {
    color: var(--ok);
  }

  .bad {
    color: var(--danger);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  @media (max-width: 860px) {
    .tabs {
      grid-template-columns: repeat(2, 1fr);
    }

    .row {
      grid-template-columns: 36px minmax(0, 1fr) 56px;
    }

    /* The target goes under the file name: three columns do not fit a phone. */
    .row .to {
      grid-column: 2 / -1;
      grid-row: 2;
    }

    .row.header .to {
      display: none;
    }
  }
</style>
