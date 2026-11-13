<script lang="ts">
  import { onMount } from 'svelte';
  import { formatBytes } from '@kinoshelf/i18n';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import {
    CARDS,
    SETTINGS_SECTION,
    freeShare,
    problemText,
    problemsOf,
    stateOf,
    uptimeParts,
    worst,
    type CardId,
    type CardState,
    type Delivery,
    type HealthReport,
  } from '../lib/health.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import type { Settings } from '../lib/settings.js';
  import type { WatchScan, WatchStatus } from '../lib/watch.js';
  import Link from './Link.svelte';

  const TOPICS = ['health', 'jobs', 'history', 'settings', 'ready'] as const;
  const report = resource<HealthReport>(() => api.get<HealthReport>('/api/health/report'), TOPICS);
  const watch = resource<WatchStatus>(() => api.get<WatchStatus>('/api/watch'), TOPICS);
  const settings = resource<Settings>(
    () => api.get<Settings>('/api/settings'),
    ['settings', 'ready'],
  );

  // Uptime, the queue and the watcher's passes change with no event to say so.
  onMount(() => {
    const timer = setInterval(() => {
      void report.reload();
      void watch.reload();
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  });

  const data = $derived(report.value);
  const states = $derived(
    data
      ? (Object.fromEntries(CARDS.map((id) => [id, stateOf(id, data, watch.value)])) as Record<
          CardId,
          CardState
        >)
      : undefined,
  );
  const summary = $derived(states ? worst(Object.values(states)) : undefined);
  const counted = $derived(
    data
      ? data.problems.filter((p) => p.severity === (summary === 'danger' ? 'error' : 'warn')).length
      : 0,
  );

  const bytes = (n: number): string => formatBytes(n, locale.value);
  const when = (iso: string): string =>
    new Date(iso).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'medium' });

  function uptime(seconds: number): string {
    const { days, hours, minutes } = uptimeParts(seconds);
    return days > 0
      ? t('web.health.uptime.days', { days, hours })
      : hours > 0
        ? t('web.health.uptime.hours', { hours, minutes })
        : t('web.health.uptime.minutes', { minutes });
  }

  const lastRefresh = (kind: 'plex' | 'jellyfin'): Delivery | undefined =>
    data?.notify.recent.find((record) => record.kind === kind);
  const webhooks = $derived((data?.notify.recent ?? []).filter((r) => r.kind === 'webhook'));

  let checking = $state(false);
  let checked = $state<string | undefined>(undefined);
  async function checkNow(): Promise<void> {
    checking = true;
    checked = undefined;
    try {
      const result = await api.post<WatchScan>('/api/watch/scan');
      checked = t('web.health.watch.done', { count: result.submitted });
    } catch (error) {
      report.failure = error;
    } finally {
      checking = false;
      await Promise.all([watch.reload(), report.reload()]);
    }
  }
</script>

<div class="health">
  {#if report.failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, report.failure)}</p>
  {/if}

  {#if data === undefined || states === undefined}
    {#if !report.failure}<p class="muted" role="status">{t('web.loading')}</p>{/if}
  {:else}
    <p
      class="alert"
      class:alert-warn={summary === 'warn'}
      class:alert-danger={summary === 'danger'}
      role={summary === 'danger' ? 'alert' : 'status'}
    >
      {summary === 'ok'
        ? t('web.health.summary.ok')
        : t(`web.health.summary.${summary ?? 'ok'}`, { count: counted })}
    </p>

    <div class="grid">
      {#each CARDS as id (id)}
        {@const state = states[id]}
        {@const problems = problemsOf(data, id)}
        <section class="card" aria-labelledby="health-{id}" data-state={state}>
          <header>
            <h2 id="health-{id}">{t(`web.health.card.${id}`)}</h2>
            <span
              class="chip"
              class:chip-ok={state === 'ok'}
              class:chip-warn={state === 'warn'}
              class:chip-danger={state === 'danger'}
              class:off={state === 'off'}>{t(`web.health.state.${state}`)}</span
            >
          </header>

          <ul class="lines">
            {#if id === 'server'}
              <li>{t('web.health.server.version', { version: data.server.version })}</li>
              <li>{t('web.health.server.uptime', { time: uptime(data.server.uptimeSeconds) })}</li>
              <li>
                {t('web.health.server.runtime', { node: data.server.node, arch: data.server.arch })}
              </li>
              <li class="mono path">
                {t('web.health.server.config', { path: data.server.configDir })}
              </li>
            {:else if id === 'ffprobe'}
              <li>
                {data.ffprobe.version === null
                  ? t('web.health.ffprobe.missing')
                  : t('web.health.ffprobe.ok', { version: data.ffprobe.version })}
              </li>
            {:else if id === 'database'}
              {#if data.database.sizeBytes !== null}
                <li>{t('web.health.database.size', { size: bytes(data.database.sizeBytes) })}</li>
              {/if}
              <li>{t('web.health.database.journal', { count: data.database.journalEntries })}</li>
              <li>{t('web.health.database.cache', { count: data.database.cacheEntries })}</li>
              {#if data.database.migrations.last}
                <li class="path">
                  {t('web.health.database.migrations', {
                    count: data.database.migrations.applied,
                    name: data.database.migrations.last.name,
                  })}
                </li>
              {/if}
            {:else if id === 'disk'}
              {#each data.disks as disk (disk.libraryId)}
                {@const share = freeShare(disk)}
                <li class="disk">
                  <span class="between">
                    <strong>{disk.name}</strong>
                    <span class="muted">
                      {share === null || disk.freeBytes === null || disk.totalBytes === null
                        ? t('web.health.disk.unreachable')
                        : t('web.health.disk.free', {
                            free: bytes(disk.freeBytes),
                            total: bytes(disk.totalBytes),
                          })}
                    </span>
                  </span>
                  <span class="muted mono path">{disk.path}</span>
                  {#if share !== null}
                    <span class="bar" aria-hidden="true">
                      <span class="used" class:low={share < 0.05} style:width="{(1 - share) * 100}%"
                      ></span>
                    </span>
                  {/if}
                </li>
              {:else}
                <li class="muted">{t('web.health.disk.none')}</li>
              {/each}
            {:else if id === 'queue'}
              <li>
                {t('web.health.queue.analyses', {
                  running: data.queue.analyses.running,
                  queued: data.queue.analyses.queued,
                })}
              </li>
              <li>
                {t('web.health.queue.transfers', {
                  running: data.queue.transfers.running,
                  queued: data.queue.transfers.queued,
                })}
              </li>
              <li>
                {data.queue.probes === 0
                  ? t('web.health.queue.probes.idle')
                  : t('web.health.queue.probes', { count: data.queue.probes })}
              </li>
              <li>
                {data.queue.completeness === 0
                  ? t('web.health.queue.completeness.idle')
                  : t('web.health.queue.completeness', { count: data.queue.completeness })}
              </li>
            {:else if id === 'watch'}
              {#if watch.value === undefined || !watch.value.enabled}
                <li class="muted">{t('web.health.watch.off')}</li>
              {:else}
                {@const status = watch.value}
                {#each status.folders as folder (folder.path)}
                  <li class="between">
                    <span class="mono path">{folder.path}</span>
                    {#if !folder.available}
                      <span class="chip chip-danger">{t('web.health.watch.unreachable')}</span>
                    {:else}
                      <span class="muted">
                        {t('web.health.watch.sent', { count: folder.sentLastDay })}
                      </span>
                    {/if}
                  </li>
                {/each}
                {#if status.intervalSeconds !== null}
                  <li class="muted">
                    {t(`web.health.watch.mode.${status.mode}`, {
                      minutes: Math.max(1, Math.round(status.intervalSeconds / 60)),
                    })}
                  </li>
                {/if}
                <li>
                  {status.lastScanAt === null
                    ? t('web.health.watch.never')
                    : t('web.health.watch.last', { when: when(status.lastScanAt) })}
                </li>
                {#if status.nextScanAt !== null}
                  <li>{t('web.health.watch.next', { when: when(status.nextScanAt) })}</li>
                {/if}
                {#if status.pending > 0}
                  <li>{t('web.health.watch.pending', { count: status.pending })}</li>
                {/if}
                <li class="actions">
                  <button type="button" class="btn" disabled={checking} onclick={checkNow}>
                    {t('web.health.watch.now')}
                  </button>
                  {#if checked}<span class="muted" role="status">{checked}</span>{/if}
                </li>
              {/if}
            {:else if id === 'media'}
              {#if !data.notify.plex && !data.notify.jellyfin}
                <li class="muted">{t('web.health.media.off')}</li>
              {/if}
              {#each [{ kind: 'plex', on: data.notify.plex }, { kind: 'jellyfin', on: data.notify.jellyfin }] as target (target.kind)}
                {#if target.on}
                  {@const last = lastRefresh(target.kind as 'plex' | 'jellyfin')}
                  <li>
                    {t(`web.health.media.${target.kind as 'plex' | 'jellyfin'}`)}
                    {#if target.kind === 'plex' && settings.value?.plexAccount === 'signed-in'}
                      <span class="muted"> · {t('web.health.media.plex.account')}</span>
                    {/if}
                  </li>
                  <li class="muted sub">
                    {last
                      ? t('web.health.media.last', {
                          when: when(last.at),
                          result: last.ok
                            ? t('web.health.media.ok')
                            : t('web.health.media.failed', { count: last.failed ?? 1 }),
                        })
                      : t('web.health.media.none')}
                  </li>
                {/if}
              {/each}
            {:else}
              {#if data.notify.webhooks === 0}
                <li class="muted">{t('web.health.webhooks.off')}</li>
              {:else if webhooks.length === 0}
                <li class="muted">{t('web.health.webhooks.none')}</li>
              {:else}
                {#each webhooks.slice(0, 5) as record (record.at + record.target + record.event)}
                  <li class="between">
                    <span>
                      <span class="muted">{when(record.at)}</span>
                      <span class="mono">{record.target}</span>
                      <span class="muted">· {record.event}</span>
                    </span>
                    <span
                      class="chip"
                      class:chip-ok={record.ok}
                      class:chip-danger={!record.ok}
                      title={record.attempts === undefined
                        ? undefined
                        : t('web.health.webhooks.attempts', { count: record.attempts })}
                    >
                      {record.ok ? t('web.health.webhooks.sent') : (record.error ?? 'HTTP')}
                    </span>
                  </li>
                {/each}
              {/if}
            {/if}
          </ul>

          {#if problems.length > 0}
            <ul class="causes">
              {#each problems as problem, index (index)}
                <li class="cause" class:danger={problem.severity === 'error'}>
                  {t(problemText(problem), problem.params)}
                </li>
              {/each}
            </ul>
            {#if SETTINGS_SECTION[id]}
              <Link href="/settings#{SETTINGS_SECTION[id]}" class="fix"
                >{t('web.health.fix')} →</Link
              >
            {/if}
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .health {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 12px;
  }

  .card {
    gap: 12px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  h2 {
    font-size: 16px;
    margin: 0;
  }

  .off {
    color: var(--muted);
    background: var(--surface-2, transparent);
    border: 1px solid var(--border);
  }

  .lines,
  .causes {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 14px;
  }

  .between {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 4px 12px;
  }

  .path {
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .sub {
    margin-top: -4px;
    font-size: 13px;
  }

  .disk {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .bar {
    display: block;
    height: 6px;
    border-radius: 3px;
    background: var(--border);
    overflow: hidden;
  }

  .used {
    display: block;
    height: 100%;
    background: var(--muted);
  }

  .used.low {
    background: var(--danger);
  }

  .actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
  }

  .cause {
    color: var(--warn);
  }

  .cause.danger {
    color: var(--danger);
  }

  .card :global(.fix) {
    font-size: 14px;
  }
</style>
