<script lang="ts">
  import { describeError } from '@kinoshelf/i18n';
  import BatchDetail from '../components/BatchDetail.svelte';
  import JobDetail from '../components/JobDetail.svelte';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { historyIdOf } from '../lib/routes.js';
  import { STATUS_CHIP, formatDate, type Activity } from '../lib/history.js';

  const PAGE = 50;

  let items = $state<readonly Activity[] | undefined>(undefined);
  let total = $state(0);
  let all = $state(false);
  let failure = $state<unknown>(undefined);
  let notice = $state<string | undefined>(undefined);

  // The line is in the path (`/history/<id>`), so a link, a reload and the back button keep it.
  const selected = $derived(historyIdOf(router.path));
  // A line linked to (a failed scan's banner, a job sent again) may not be on the pages read: it is
  // looked up on its own rather than replaced by the first line.
  let outside = $state<Pick<Activity, 'id' | 'kind'> | undefined>(undefined);
  const listed = $derived(items?.find((line) => line.id === selected));
  const open = $derived(
    selected === undefined
      ? items?.[0]
      : (listed ?? (outside?.id === selected ? outside : undefined)),
  );
  $effect(() => {
    if (selected !== undefined && items !== undefined && listed === undefined) {
      void lookUp(selected);
    }
  });

  async function lookUp(id: string): Promise<void> {
    if (outside?.id === id) {
      return;
    }
    try {
      await api.get(`/api/batches/${id}`);
      outside = { id, kind: 'batch' };
    } catch {
      // Not a batch: a job, whose page says if it is gone.
      outside = { id, kind: 'job' };
    }
  }

  // Each read carries a ticket: an answer to a read that a newer one replaced is dropped, so a
  // slow page never overwrites a fresher list (or the other filter's).
  let latest = 0;

  async function page(
    offset: number,
    limit: number,
  ): Promise<{ total: number; items: Activity[] }> {
    return api.get<{ total: number; items: Activity[] }>(
      `/api/history?limit=${limit}&offset=${offset}&all=${all}`,
    );
  }

  /** Lines already shown win: a line that moved down a page as new ones arrived is not listed twice. */
  const append = (shown: readonly Activity[], next: readonly Activity[]): Activity[] => {
    const known = new Set(shown.map((line) => line.id));
    return [...shown, ...next.filter((line) => !known.has(line.id))];
  };

  /** Reads again what is shown, as many lines as were: an event must not fold the list. */
  async function load(): Promise<void> {
    const ticket = ++latest;
    try {
      const shown = Math.max(items?.length ?? 0, PAGE);
      const first = await page(0, Math.min(shown, 200));
      let read = first.items;
      while (read.length < shown && read.length < first.total) {
        const next = await page(read.length, Math.min(shown - read.length, 200));
        if (next.items.length === 0) {
          break;
        }
        read = append(read, next.items);
      }
      if (ticket === latest) {
        items = read;
        total = first.total;
        failure = undefined;
      }
    } catch (error) {
      if (ticket === latest) {
        failure = error;
      }
    }
  }

  async function more(): Promise<void> {
    const ticket = latest;
    const shown = items ?? [];
    try {
      const next = await page(shown.length, PAGE);
      if (ticket === latest) {
        items = append(shown, next.items);
        total = next.total;
      }
    } catch (error) {
      if (ticket === latest) {
        failure = error;
      }
    }
  }

  function toggle(): void {
    all = !all;
    items = undefined;
    void load();
  }

  const select = (line: Activity): void => {
    notice = undefined;
    router.navigate(`/history/${line.id}`);
  };

  refetchOn(['history', 'jobs', 'ready'], () => void load());
</script>

<div class="page">
  <div class="head">
    <h1>{t('web.history.title')}</h1>
    <p class="muted">{t('web.history.intro')}</p>
  </div>

  {#if notice}
    <p class="alert notice" role="status">{notice}</p>
  {/if}

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {:else if items === undefined}
    <p class="muted" role="status">{t('web.loading')}</p>
  {:else}
    <label class="all">
      <input type="checkbox" checked={all} onchange={toggle} />
      <span>{t('web.history.show-all')}</span>
      <span class="muted">{t('web.history.show-all.hint')}</span>
    </label>

    {#if items.length === 0}
      <p class="card muted">{t('web.history.empty')}</p>
    {:else}
      <div class="layout">
        <div class="side">
          <ul class="list" aria-label={t('web.history.list.label')}>
            {#each items as line (line.id)}
              <li>
                <button
                  type="button"
                  class:current={open?.id === line.id}
                  aria-current={open?.id === line.id ? 'true' : undefined}
                  onclick={() => {
                    select(line);
                  }}
                >
                  <span class="top">
                    <strong>{formatDate(line.at, locale.value)}</strong>
                    <span class="chip {STATUS_CHIP[line.status]}"
                      >{t(`web.history.status.${line.status}`)}</span
                    >
                  </span>
                  <span class="muted mono where">{line.path ?? t('web.history.origin.cli')}</span>
                  {#if line.kind === 'batch'}
                    <span class="muted">
                      {t('web.history.files', { count: line.operations })}
                      {#if line.failed > 0}· {t('web.history.failed-files', {
                          count: line.failed,
                        })}{/if}
                      {#if line.modes.length > 0}
                        · {line.modes.map((mode) => t(`web.history.mode.${mode}`)).join(', ')}
                      {/if}
                    </span>
                  {:else}
                    <span class="muted">
                      {t('web.history.kind.job')}
                      {#if line.error}· {describeError(t, line.error)}{/if}
                      {#if line.routine}· {t('web.history.routine')}{/if}
                    </span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
          {#if items.length < total}
            <button type="button" class="btn" onclick={() => void more()}>
              {t('web.history.more', { shown: items.length, total })}
            </button>
          {/if}
        </div>

        <div>
          {#if open}
            {#key open.id}
              {#if open.kind === 'batch'}
                <BatchDetail
                  id={open.id}
                  ondone={(message: string) => {
                    notice = message;
                  }}
                />
              {:else}
                <JobDetail id={open.id} />
              {/if}
            {/key}
          {:else}
            <p class="muted">{t('web.history.select')}</p>
          {/if}
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

  h1 {
    font-size: 22px;
    margin-bottom: 4px;
  }

  .notice {
    color: var(--ok);
    background: var(--ok-bg);
    border-color: var(--ok);
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(260px, 380px) 1fr;
    gap: 16px;
    align-items: start;
  }

  .all {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .list button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    width: 100%;
    min-height: 44px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    text-align: left;
    cursor: pointer;
  }

  .list button:hover {
    background: var(--surface-2);
  }

  .list button.current {
    border-color: var(--accent);
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
  }

  .where {
    font-size: 11px;
  }

  @media (max-width: 860px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
