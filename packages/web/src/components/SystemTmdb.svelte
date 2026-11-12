<script lang="ts">
  import { untrack } from 'svelte';
  import { formatBytes } from '@kinoshelf/i18n';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { oneOf } from '../lib/routes.js';
  import type { Settings } from '../lib/settings.js';
  import {
    USAGE_KINDS,
    USAGE_PERIODS,
    errorsOf,
    hitRate,
    recentError,
    sentOf,
    tallest,
    type UsageCounts,
    type UsageReport,
    type UsageSlot,
  } from '../lib/tmdb.js';
  import Link from './Link.svelte';

  // `range`, not `period`: the logs tab has its own, with other values, in the same URL.
  const period = $derived(oneOf(router.query.get('range'), USAGE_PERIODS) ?? '24h');

  // What the next read asks for: set when the period changes, read by the fetcher.
  let wanted: string = '24h';
  const usage = resource<UsageReport>(
    () => api.get<UsageReport>(`/api/tmdb/usage?period=${wanted}`),
    ['tmdb', 'ready'],
  );
  const settings = resource<Settings>(
    () => api.get<Settings>('/api/settings'),
    ['settings', 'ready'],
  );

  // A new period reads again; the old figures stay until the new ones arrive.
  $effect(() => {
    wanted = period;
    untrack(() => {
      void usage.reload();
    });
  });

  const report = $derived(usage.value);
  const number = (n: number): string => n.toLocaleString(locale.value);
  const total = (c: UsageCounts): number => c.network + c.cache + errorsOf(c);

  const limited = $derived(
    report ? recentError(report.recentErrors, 'rate-limited', Date.now()) : false,
  );
  const refused = $derived(
    report ? recentError(report.recentErrors, 'refused', Date.now()) : false,
  );
  const noKey = $derived(settings.value !== undefined && !settings.value.tmdb.configured);

  // Chart: bars share one scale, drawn in a 100 x 40 box stretched to the width.
  let reading = $state<UsageSlot | undefined>(undefined);
  const peak = $derived(report ? tallest(report.slots) : 1);
  const slotLabel = (slot: UsageSlot): string =>
    new Date(slot.start).toLocaleString(locale.value, {
      ...(period === '24h'
        ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
        : { day: 'numeric', month: 'short' }),
    });

  let testing = $state(false);
  let verdict = $state<{ ok: boolean; text: string } | undefined>(undefined);
  async function test(): Promise<void> {
    testing = true;
    verdict = undefined;
    try {
      await api.post('/api/settings/tmdb/test');
      verdict = { ok: true, text: t('web.settings.tmdb.ok') };
    } catch (error) {
      verdict = { ok: false, text: messageOf(t, error) };
    } finally {
      testing = false;
    }
  }

  let confirming = $state(false);
  let cleared = $state<string | undefined>(undefined);
  async function clear(): Promise<void> {
    confirming = false;
    try {
      const { removed } = await api.delete<{ removed: number }>('/api/tmdb/cache');
      cleared = t('web.tmdb.cache.cleared', { count: removed });
      await usage.reload();
    } catch (error) {
      usage.failure = error;
    }
  }
</script>

<div class="tmdb">
  <div class="bar">
    <div class="field">
      <span id="tmdb-range-label">{t('web.tmdb.range')}</span>
      <div class="segments" role="group" aria-labelledby="tmdb-range-label">
        {#each USAGE_PERIODS as option (option)}
          <button
            type="button"
            class="segment"
            class:on={period === option}
            aria-pressed={period === option}
            onclick={() => {
              router.setQuery({ range: option === '24h' ? undefined : option });
            }}
          >
            {t(`web.tmdb.range.${option}`)}
          </button>
        {/each}
      </div>
    </div>
    <p class="muted honest">{t('web.tmdb.honest')}</p>
  </div>

  {#if usage.failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, usage.failure)}</p>
  {/if}
  {#if noKey}
    <p class="alert alert-warn" role="status">
      {t('web.tmdb.nokey')}
      <Link href="/settings">{t('web.tmdb.nokey.link')}</Link>
    </p>
  {:else if refused}
    <p class="alert alert-danger" role="alert">
      {t('web.tmdb.refused')}
      <Link href="/settings">{t('web.tmdb.nokey.link')}</Link>
    </p>
  {/if}
  {#if limited}
    <p class="alert alert-warn" role="status">{t('web.tmdb.limited')}</p>
  {/if}

  {#if report === undefined}
    {#if !usage.failure}<p class="muted" role="status">{t('web.loading')}</p>{/if}
  {:else}
    <div class="tiles">
      <div class="card tile">
        <span class="label muted">{t('web.tmdb.tile.sent')}</span>
        <strong class="value mono">{number(sentOf(report.totals))}</strong>
        <span class="muted hint">{t('web.tmdb.tile.sent.hint')}</span>
      </div>
      <div class="card tile">
        <span class="label muted">{t('web.tmdb.tile.cache')}</span>
        <strong class="value mono">{number(report.totals.cache)}</strong>
        <span class="muted hint">
          {hitRate(report.totals) === null
            ? t('web.tmdb.tile.cache.none')
            : t('web.tmdb.tile.cache.hint', { rate: hitRate(report.totals) ?? 0 })}
        </span>
      </div>
      <div class="card tile">
        <span class="label muted">{t('web.tmdb.tile.errors')}</span>
        <strong class="value mono" class:bad={errorsOf(report.totals) > 0}>
          {number(errorsOf(report.totals))}
        </strong>
        <span class="muted hint">
          {t('web.tmdb.tile.errors.hint', {
            limited: number(report.totals.rateLimited),
            server: number(report.totals.serverError),
            network: number(report.totals.unreachable),
          })}
        </span>
      </div>
      <div class="card tile">
        <span class="label muted">{t('web.tmdb.tile.latency')}</span>
        <strong class="value mono">
          {report.totals.latencyMs === null
            ? t('web.tmdb.tile.latency.none')
            : t('web.tmdb.tile.latency.value', { ms: number(report.totals.latencyMs) })}
        </strong>
        <span class="muted hint">{t('web.tmdb.tile.latency.hint')}</span>
      </div>
    </div>

    {#if total(report.totals) === 0}
      <p class="card muted empty">{t('web.tmdb.empty')}</p>
    {:else}
      <section class="card" aria-labelledby="tmdb-chart">
        <h2 id="tmdb-chart">{t('web.tmdb.chart')}</h2>
        <svg
          class="chart"
          viewBox="0 0 {report.slots.length * 10} 40"
          preserveAspectRatio="none"
          role="img"
          aria-label={t('web.tmdb.chart')}
        >
          {#each report.slots as slot, index (slot.start)}
            {@const scale = 40 / peak}
            {@const errors = slot.errors * scale}
            {@const network = slot.network * scale}
            {@const cache = slot.cache * scale}
            <g
              role="presentation"
              class:picked={reading?.start === slot.start}
              onmouseenter={() => (reading = slot)}
              onmouseleave={() => (reading = undefined)}
            >
              <rect x={index * 10} y="0" width="10" height="40" class="hit" />
              <rect x={index * 10 + 1} y={40 - cache} width="8" height={cache} class="cache" />
              <rect
                x={index * 10 + 1}
                y={40 - cache - network}
                width="8"
                height={network}
                class="network"
              />
              <rect
                x={index * 10 + 1}
                y={40 - cache - network - errors}
                width="8"
                height={errors}
                class="errors"
              />
              <title>
                {t('web.tmdb.chart.reading', {
                  start: slotLabel(slot),
                  network: number(slot.network),
                  cache: number(slot.cache),
                  errors: number(slot.errors),
                })}
              </title>
            </g>
          {/each}
        </svg>
        <p class="muted reading" role="status">
          {reading
            ? t('web.tmdb.chart.reading', {
                start: slotLabel(reading),
                network: number(reading.network),
                cache: number(reading.cache),
                errors: number(reading.errors),
              })
            : t('web.tmdb.chart.hint')}
        </p>
        <ul class="legend">
          <li><span class="swatch network"></span>{t('web.tmdb.legend.network')}</li>
          <li><span class="swatch cache"></span>{t('web.tmdb.legend.cache')}</li>
          <li><span class="swatch errors"></span>{t('web.tmdb.legend.errors')}</li>
        </ul>
      </section>

      <section class="card" aria-labelledby="tmdb-kinds">
        <h2 id="tmdb-kinds">{t('web.tmdb.kinds')}</h2>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('web.tmdb.kinds.kind')}</th>
                <th scope="col" class="num">{t('web.tmdb.kinds.network')}</th>
                <th scope="col" class="num">{t('web.tmdb.kinds.cache')}</th>
                <th scope="col" class="num">{t('web.tmdb.kinds.errors')}</th>
                <th scope="col" class="num">{t('web.tmdb.kinds.latency')}</th>
              </tr>
            </thead>
            <tbody>
              {#each USAGE_KINDS as kind (kind)}
                {@const row = report.kinds.find((k) => k.kind === kind)}
                {#if row && total(row) > 0}
                  <tr>
                    <th scope="row">{t(`web.tmdb.kind.${kind}`)}</th>
                    <td class="num mono">{number(row.network)}</td>
                    <td class="num mono">{number(row.cache)}</td>
                    <td class="num mono">{number(errorsOf(row))}</td>
                    <td class="num mono">
                      {row.latencyMs === null
                        ? '—'
                        : t('web.tmdb.tile.latency.value', { ms: number(row.latencyMs) })}
                    </td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    <section class="card" aria-labelledby="tmdb-errors">
      <h2 id="tmdb-errors">{t('web.tmdb.errors')}</h2>
      {#if report.recentErrors.length === 0}
        <p class="muted">{t('web.tmdb.errors.none')}</p>
      {:else}
        <p class="muted">{t('web.tmdb.errors.since')}</p>
        <ul class="errors-list">
          {#each report.recentErrors.slice(0, 8) as error (error.at + error.path)}
            <li>
              <span class="mono muted">
                {new Date(error.at).toLocaleTimeString(locale.value)}
              </span>
              <span>{t(`web.tmdb.kind.${error.kind}`)}</span>
              <span class="chip chip-warn">
                {t(`web.tmdb.outcome.${error.outcome}`, { status: error.status ?? '' })}
              </span>
              <span class="mono muted path">{error.path}</span>
            </li>
          {/each}
        </ul>
        <Link href="/system?component=tmdb&level=warn">{t('web.tmdb.errors.logs')} →</Link>
      {/if}
    </section>

    <div class="pair">
      <section class="card" aria-labelledby="tmdb-key">
        <h2 id="tmdb-key">{t('web.tmdb.key')}</h2>
        <p class="muted" role="status">
          {t(`web.settings.tmdb.status.${settings.value?.tmdb.source ?? 'none'}`)}
        </p>
        <div class="row">
          <button
            type="button"
            class="btn"
            disabled={testing || !(settings.value?.tmdb.configured ?? false)}
            onclick={() => void test()}
          >
            {testing ? t('web.settings.tmdb.testing') : t('web.settings.tmdb.test')}
          </button>
          {#if verdict}
            <span class={verdict.ok ? 'ok' : 'bad'} role="status">{verdict.text}</span>
          {/if}
        </div>
      </section>

      <section class="card" aria-labelledby="tmdb-cache">
        <h2 id="tmdb-cache">{t('web.tmdb.cache')}</h2>
        <p class="muted">
          {t('web.tmdb.cache.size', {
            count: report.cache.entries,
            size: formatBytes(report.cache.bytes, locale.value),
          })}
        </p>
        {#if confirming}
          <p>{t('web.tmdb.cache.confirm')}</p>
          <div class="row">
            <button type="button" class="btn btn-danger" onclick={() => void clear()}>
              {t('web.tmdb.cache.confirm.yes')}
            </button>
            <button
              type="button"
              class="btn"
              onclick={() => {
                confirming = false;
              }}
            >
              {t('web.tmdb.cache.confirm.no')}
            </button>
          </div>
        {:else}
          <div class="row">
            <button
              type="button"
              class="btn"
              disabled={report.cache.entries === 0}
              onclick={() => {
                cleared = undefined;
                confirming = true;
              }}
            >
              {t('web.tmdb.cache.clear')}
            </button>
            {#if cleared}<span class="muted" role="status">{cleared}</span>{/if}
          </div>
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .tmdb {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px 24px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    color: var(--muted);
  }

  /* Same height as the period pills beside it, so the text is centred on them. */
  .honest {
    display: flex;
    align-items: center;
    flex: 1 1 280px;
    min-height: 46px;
    font-size: 13px;
    margin: 0;
  }

  /* The period pills are buttons: the browser's own border and grey are taken off. */
  .segment {
    border: 0;
    font: inherit;
    font-weight: 600;
  }

  .segment:not(.on) {
    background: transparent;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 12px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .label {
    font-size: 13px;
  }

  .value {
    font-size: 26px;
    font-weight: 600;
  }

  .value.bad,
  .bad {
    color: var(--danger);
  }

  .ok {
    color: var(--ok);
  }

  .hint {
    font-size: 13px;
  }

  h2 {
    font-size: 16px;
    margin-bottom: 8px;
  }

  .empty {
    text-align: center;
  }

  .chart {
    width: 100%;
    height: 160px;
    display: block;
    border-bottom: 1px solid var(--border);
  }

  .chart .hit {
    fill: transparent;
  }

  .chart .network {
    fill: var(--info);
  }

  .chart .cache {
    fill: var(--ok);
  }

  .chart .errors {
    fill: var(--danger);
  }

  .chart g.picked .hit {
    fill: var(--neutral-bg);
  }

  .reading {
    min-height: 1.5em;
    font-size: 13px;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    list-style: none;
    padding: 0;
    font-size: 13px;
  }

  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }

  .swatch.network {
    background: var(--info);
  }

  .swatch.cache {
    background: var(--ok);
  }

  .swatch.errors {
    background: var(--danger);
  }

  .scroll {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }

  th,
  td {
    padding: 8px 10px;
    text-align: left;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }

  thead th {
    color: var(--muted);
    font-weight: 500;
    font-size: 13px;
  }

  tbody th {
    font-weight: 500;
  }

  .num {
    text-align: right;
  }

  .errors-list {
    list-style: none;
    padding: 0;
    margin: 8px 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
  }

  .errors-list li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
  }

  .path {
    overflow-wrap: anywhere;
    font-size: 12px;
  }

  .pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
  }
</style>
