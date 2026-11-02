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
  const open = $derived(items?.find((line) => line.id === selected) ?? items?.[0]);

  async function page(offset: number, limit: number): Promise<void> {
    const body = await api.get<{ total: number; items: Activity[] }>(
      `/api/history?limit=${limit}&offset=${offset}&all=${all}`,
    );
    total = body.total;
    items = offset === 0 ? body.items : [...(items ?? []), ...body.items];
  }

  /** Reads again what is shown, as many lines as were: an event must not fold the list. */
  async function load(): Promise<void> {
    try {
      const shown = Math.max(items?.length ?? 0, PAGE);
      await page(0, Math.min(shown, 200));
      for (let read = items?.length ?? 0; read < shown && read < total; read = items?.length ?? 0) {
        await page(read, Math.min(shown - read, 200));
      }
      failure = undefined;
    } catch (error) {
      failure = error;
    }
  }

  async function more(): Promise<void> {
    try {
      await page(items?.length ?? 0, PAGE);
    } catch (error) {
      failure = error;
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
