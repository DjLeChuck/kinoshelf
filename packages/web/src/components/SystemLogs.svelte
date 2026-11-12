<script lang="ts">
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { formatBytes } from '@kinoshelf/i18n';
  import { api } from '../lib/api.js';
  import { copyText } from '../lib/clipboard.js';
  import { messageOf } from '../lib/errors.js';
  import { onTopics } from '../lib/events.svelte.js';
  import { formatDate } from '../lib/history.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import {
    LEVEL_CHIP,
    LEVEL_FILTERS,
    LOG_COMPONENTS,
    LOG_LEVELS,
    NO_FILTERS,
    PERIODS,
    detailOf,
    formatFull,
    formatLogTime,
    isFiltered,
    logsQuery,
    type LogFilters,
    type LogLevel,
    type LogPage,
  } from '../lib/logs.js';
  import { router } from '../lib/router.svelte.js';
  import { oneOf } from '../lib/routes.js';
  import Chevron from './Chevron.svelte';
  import Link from './Link.svelte';

  // The filters are in the URL, so a link ("see the TMDB lines") opens the page already filtered.
  const filters = $derived<LogFilters>({
    level: oneOf(router.query.get('level'), LEVEL_FILTERS) ?? NO_FILTERS.level,
    component: oneOf(router.query.get('component'), LOG_COMPONENTS),
    q: router.query.get('q') ?? '',
    period: oneOf(router.query.get('period'), PERIODS) ?? NO_FILTERS.period,
  });
  const query = $derived(logsQuery(filters));

  let page = $state<LogPage | undefined>(undefined);
  let failure = $state<unknown>(undefined);
  let follow = $state(true);
  /** Lines written since the list was read, while following is paused. */
  let newer = $state(0);
  const opened = new SvelteSet<number>();
  let copied = $state<number | undefined>(undefined);
  let copyFailed = $state<number | undefined>(undefined);
  // What is typed, until the pause that sends it to the URL; the URL's value when it changes.
  let draft = $derived(filters.q);
  let latest = 0;

  // Each read carries a ticket: a slow answer never replaces a fresher one.
  async function load(text: string): Promise<void> {
    const ticket = ++latest;
    try {
      const read = await api.get<LogPage>(`/api/logs${text}`);
      if (ticket === latest) {
        page = read;
        newer = 0;
        failure = undefined;
      }
    } catch (error) {
      if (ticket === latest) {
        failure = error;
      }
    }
  }

  /** While paused the list holds still; only the count of what it misses is read. */
  async function countNewer(): Promise<void> {
    const after = page?.entries[0]?.seq ?? 0;
    const ticket = latest;
    try {
      const read = await api.get<LogPage>(`/api/logs${logsQuery(filters, { limit: 1, after })}`);
      if (ticket === latest) {
        newer = read.newer;
      }
    } catch {
      // The next event asks again.
    }
  }

  $effect(() => {
    const text = query;
    untrack(() => {
      void load(text);
    });
  });

  $effect(() =>
    onTopics(['logs', 'ready'], () => {
      if (follow || page === undefined) {
        void load(query);
      } else {
        void countNewer();
      }
    }),
  );

  // The search is typed freely and reaches the URL (and the server) once typing pauses.
  let typing: ReturnType<typeof setTimeout> | undefined;
  function search(value: string): void {
    draft = value;
    clearTimeout(typing);
    typing = setTimeout(() => {
      router.setQuery({ q: value.trim() === '' ? undefined : value });
    }, 250);
  }
  $effect(() => () => {
    clearTimeout(typing);
  });

  function toggleFollow(on: boolean): void {
    follow = on;
    if (on) {
      opened.clear();
      void load(query);
    }
  }

  function toggle(seq: number): void {
    if (opened.has(seq)) {
      opened.delete(seq);
    } else {
      opened.add(seq);
      // The line would be pushed down by the ones arriving: it holds still while it is read.
      follow = false;
    }
  }

  async function copy(seq: number, text: string): Promise<void> {
    const done = await copyText(text);
    copied = done ? seq : undefined;
    copyFailed = done ? undefined : seq;
  }

  function reset(): void {
    router.setQuery({ level: undefined, component: undefined, q: undefined, period: undefined });
  }

  async function record(event: Event & { currentTarget: HTMLSelectElement }): Promise<void> {
    const level = oneOf(event.currentTarget.value, LOG_LEVELS);
    if (!level) {
      return;
    }
    try {
      await api.put<{ level: LogLevel }>('/api/logs/level', { level });
      await load(query);
    } catch (error) {
      failure = error;
    }
  }

  const stats = $derived(
    page === undefined
      ? ''
      : [
          t('web.logs.stats.kept', { count: page.kept }),
          ...(page.since === null
            ? []
            : [t('web.logs.stats.since', { since: formatDate(page.since, locale.value) })]),
          ...(page.fileBytes > 0
            ? [t('web.logs.stats.file', { size: formatBytes(page.fileBytes, locale.value) })]
            : []),
        ].join(' · '),
  );
</script>

<div class="logs">
  <div class="bar">
    <div class="field">
      <span id="log-level-label">{t('web.logs.level')}</span>
      <div class="segments" role="group" aria-labelledby="log-level-label">
        {#each LEVEL_FILTERS as option (option)}
          <button
            type="button"
            class="segment"
            class:on={filters.level === option}
            aria-pressed={filters.level === option}
            onclick={() => {
              router.setQuery({ level: option === 'all' ? undefined : option });
            }}
          >
            {t(`web.logs.level.${option}`)}
          </button>
        {/each}
      </div>
    </div>
    <div class="field grow">
      <label for="log-search">{t('web.logs.search')}</label>
      <input
        id="log-search"
        class="input"
        type="search"
        value={draft}
        placeholder={t('web.logs.search.placeholder')}
        oninput={(event) => {
          search(event.currentTarget.value);
        }}
      />
    </div>
    <div class="field">
      <label for="log-component">{t('web.logs.component')}</label>
      <select
        id="log-component"
        class="input"
        value={filters.component ?? ''}
        onchange={(event) => {
          router.setQuery({ component: event.currentTarget.value || undefined });
        }}
      >
        <option value="">{t('web.logs.component.all')}</option>
        {#each LOG_COMPONENTS as component (component)}
          <option value={component}>{component}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="log-period">{t('web.logs.period')}</label>
      <select
        id="log-period"
        class="input"
        value={filters.period}
        onchange={(event) => {
          const period = oneOf(event.currentTarget.value, PERIODS);
          router.setQuery({ period: period === 'all' ? undefined : period });
        }}
      >
        {#each PERIODS as period (period)}
          <option value={period}>{t(`web.logs.period.${period}`)}</option>
        {/each}
      </select>
    </div>
  </div>

  <div class="actions">
    <label class="follow">
      <input
        type="checkbox"
        role="switch"
        class="switch"
        checked={follow}
        onchange={(event) => {
          toggleFollow(event.currentTarget.checked);
        }}
      />
      {t('web.logs.follow')}
    </label>
    {#if page}
      <span class="muted" role="status">{t('web.logs.shown', { count: page.entries.length })}</span>
    {/if}
    <a class="btn download" href="/api/logs/download" download="kinoshelf.log">
      {t('web.logs.download')}
    </a>
  </div>

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {/if}

  {#if page === undefined}
    {#if !failure}<p class="muted" role="status">{t('web.loading')}</p>{/if}
  {:else}
    <div class="card list">
      {#if !follow && newer > 0}
        <button
          type="button"
          class="newer"
          onclick={() => {
            toggleFollow(true);
          }}
        >
          {t('web.logs.new', { count: newer })}
        </button>
      {/if}
      {#if page.entries.length === 0}
        <div class="empty">
          {#if isFiltered(filters)}
            <strong>{t('web.logs.empty.title')}</strong>
            <p class="muted">{t('web.logs.empty.body')}</p>
            <button type="button" class="btn" onclick={reset}>{t('web.logs.empty.reset')}</button>
          {:else}
            <p class="muted">{t('web.logs.none')}</p>
          {/if}
        </div>
      {:else}
        <ul aria-label={t('web.logs.list')}>
          {#each page.entries as entry (entry.seq)}
            {@const open = opened.has(entry.seq)}
            <li>
              <button
                type="button"
                class="row"
                class:failed={entry.level === 'error'}
                class:open
                aria-expanded={open}
                onclick={() => {
                  toggle(entry.seq);
                }}
              >
                <span class="time muted" title={formatFull(entry.time, locale.value)}>
                  {formatLogTime(entry.time, locale.value)}
                </span>
                <span class="level"
                  ><span class="chip {LEVEL_CHIP[entry.level]}"
                    >{t(`web.logs.chip.${entry.level}`)}</span
                  ></span
                >
                <span class="component muted">{entry.component}</span>
                <span class="message">{entry.message}</span>
                <Chevron {open} />
              </button>
              {#if open}
                <div class="detail">
                  <p class="full">{entry.message}</p>
                  <pre>{detailOf(entry)}</pre>
                  <div class="detail-actions">
                    <button
                      type="button"
                      class="btn"
                      onclick={() => void copy(entry.seq, detailOf(entry))}
                    >
                      {copied === entry.seq ? t('web.logs.copied') : t('web.logs.copy')}
                    </button>
                    {#if copyFailed === entry.seq}
                      <span class="muted" role="status">{t('web.logs.copy-failed')}</span>
                    {/if}
                    {#if entry.component === 'tmdb'}
                      <Link href="/system?tab=tmdb">{t('web.logs.tmdb')} →</Link>
                    {/if}
                    {#if entry.job}
                      <Link href={`/history/${entry.job}`}>{t('web.logs.history')} →</Link>
                    {/if}
                  </div>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="foot muted">
      <span class="mono">{stats}</span>
      <label class="recorded">
        {t('web.logs.recorded')}
        <select class="input" value={page.level} onchange={(event) => void record(event)}>
          {#each LOG_LEVELS as level (level)}
            <option value={level}>{t(`web.logs.recorded.${level}`)}</option>
          {/each}
        </select>
      </label>
    </div>
    {#if page.level === 'debug'}
      <p class="alert alert-warn" role="status">{t('web.logs.debug-warning')}</p>
    {/if}
    <p class="muted privacy">{t('web.logs.privacy')}</p>
  {/if}
</div>

<style>
  .logs {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field > label,
  .field > span {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }

  .grow {
    flex: 1 1 220px;
    min-width: 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
  }

  .follow {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    cursor: pointer;
  }

  /* The level pills are buttons: the browser's own border and grey are taken off. */
  .segment {
    border: 0;
    font: inherit;
    font-weight: 600;
  }

  .segment:not(.on) {
    background: transparent;
  }

  /* A track and a knob rather than a tick: it says "on" or "off", not "chosen". */
  .switch {
    position: relative;
    flex: none;
    width: 40px;
    height: 24px;
    border: 0;
    border-radius: 12px;
    background: var(--border-strong);
  }

  .switch::before {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 9px;
    background: var(--text);
    transition: left 0.15s ease;
  }

  .switch:checked {
    background: var(--accent);
    background-image: none;
  }

  .switch:checked::before {
    left: 19px;
    background: var(--on-accent);
  }

  .switch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .download {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    text-decoration: none;
  }

  .list {
    gap: 0;
    padding: 0;
    overflow: hidden;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    border-bottom: 1px solid var(--border);
  }

  li:last-child {
    border-bottom: 0;
  }

  .newer {
    min-height: 44px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: var(--info-bg);
    color: var(--info);
    font-weight: 600;
    cursor: pointer;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    width: 100%;
    min-height: 44px;
    padding: 8px 16px;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-family: var(--mono);
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
  }

  .row.failed {
    background: var(--danger-bg);
  }

  .row.open {
    background: var(--surface-2);
  }

  .time {
    flex: 0 0 112px;
  }

  /* One width for every level, so the component and the message line up from row to row. */
  .level {
    flex: 0 0 76px;
  }

  .component {
    flex: 0 0 72px;
  }

  .message {
    flex: 1 1 280px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row :global(.chevron) {
    margin-right: 0;
  }

  .detail {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 4px 16px 16px;
    background: var(--surface-2);
  }

  .full {
    margin: 0;
    overflow-wrap: anywhere;
  }

  pre {
    margin: 0;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .detail-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 48px 20px;
    text-align: center;
  }

  .empty p {
    margin: 0;
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    font-size: 13px;
  }

  .recorded {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .privacy {
    max-width: 80ch;
    margin: 0;
    font-size: 12px;
  }

  @media (max-width: 640px) {
    .time,
    .level,
    .component {
      flex: 0 0 auto;
    }

    .message {
      flex-basis: 100%;
    }
  }
</style>
