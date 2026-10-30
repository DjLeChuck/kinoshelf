<script lang="ts">
  import { describeError } from '@kinoshelf/i18n';
  import Link from '../components/Link.svelte';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { formatDate } from '../lib/history.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import {
    CLASSIFICATIONS,
    destinationsOf,
    followUp,
    formatDuration,
    settingsDrift,
    shortId,
    total,
    type Classification,
    type JobDetail,
  } from '../lib/job.js';
  import { releaseName, type ErrorBody, type QueueEntry } from '../lib/queue.js';
  import type { Settings } from '../lib/settings.js';

  const PAGE = 50;

  let { id }: { id: string } = $props();

  let job = $state<JobDetail | undefined>(undefined);
  let current = $state<Settings['processing'] | undefined>(undefined);
  let failure = $state<unknown>(undefined);
  let filter = $state<Classification | undefined>(undefined);
  let files = $state<readonly QueueEntry[]>([]);
  let more = $state(false);
  let showTech = $state(false);
  let transferring = $state(false);
  let transferStarted = $state(false);
  let resending = $state(false);
  let resent = $state<string | undefined>(undefined);
  let resendFailure = $state<unknown>(undefined);

  async function loadFiles(append: boolean): Promise<void> {
    const classification = filter ? `&classification=${filter}` : '';
    const page = await api.get<QueueEntry[]>(
      `/api/jobs/${id}/entries?limit=${PAGE}&offset=${append ? files.length : 0}${classification}`,
    );
    files = append ? [...files, ...page] : page;
    more = page.length === PAGE;
  }

  async function load(): Promise<void> {
    try {
      job = await api.get<JobDetail>(`/api/jobs/${id}`);
      // The frozen settings are only compared with today's once the job has any.
      if (job.settings && current === undefined) {
        current = (await api.get<Settings>('/api/settings')).processing;
      }
      if (job.status === 'done') {
        await loadFiles(false);
      }
      failure = undefined;
    } catch (error) {
      failure = error;
    }
  }

  async function pick(next: Classification | undefined): Promise<void> {
    filter = filter === next ? undefined : next;
    try {
      await loadFiles(false);
    } catch (error) {
      failure = error;
    }
  }

  async function transfer(): Promise<void> {
    transferring = true;
    resendFailure = undefined;
    try {
      await api.post(`/api/plans/${id}/execute`, {});
      transferStarted = true;
      await load();
    } catch (error) {
      resendFailure = error;
    } finally {
      transferring = false;
    }
  }

  async function resend(): Promise<void> {
    if (!job) {
      return;
    }
    resending = true;
    resendFailure = undefined;
    try {
      const created = await api.post<{ id: string }>('/api/jobs', {
        path: job.path,
        apply: job.apply,
      });
      resent = created.id;
    } catch (error) {
      resendFailure = error;
    } finally {
      resending = false;
    }
  }

  // The job and its page are keyed by the route: `id` does not change during this component's life.
  refetchOn(['jobs', 'history', 'queue', 'ready'], () => void load());

  const describe = (error: ErrorBody): string =>
    describeError(t, { code: error.code, params: error.params });

  const drift = $derived(job?.settings && current ? settingsDrift(job.settings, current) : []);
  const driftOf = (field: string): string | undefined => drift.find((d) => d.field === field)?.now;
  const duration = $derived(
    job?.startedAt && job.finishedAt ? formatDuration(job.startedAt, job.finishedAt) : undefined,
  );
  const batchId = $derived(job?.execution?.batchId ?? null);
  const roots = $derived(job?.settings ? destinationsOf(job.settings.destinationRoot) : undefined);

  const time = (iso: string): string =>
    new Intl.DateTimeFormat(locale.value, { timeStyle: 'medium' }).format(new Date(iso));

  function resultOf(file: QueueEntry): string {
    if (file.resolution) {
      return t(`web.job.result.${file.resolution}`);
    }
    return file.classification === 'compliant'
      ? t('web.job.result.nothing')
      : t('web.job.result.waiting');
  }
</script>

<div class="page">
  <nav aria-label={t('web.job.crumb')} class="muted crumb">
    <Link href="/history">{t('web.nav.history')}</Link>
    <span aria-hidden="true">›</span>
    {t('web.job.title', { id: shortId(id) })}
  </nav>

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {:else if job === undefined}
    <p class="muted" role="status">{t('web.loading')}</p>
  {:else}
    <header class="head">
      <div class="title">
        <div class="chips">
          <span
            class="chip"
            class:chip-ok={job.status === 'done'}
            class:chip-danger={job.status === 'failed'}
            class:chip-neutral={job.status === 'queued' || job.status === 'running'}
            >{t(`web.job.status.${job.status}`)}</span
          >
          <span class="chip chip-neutral"
            >{t(job.apply ? 'web.job.kind.apply' : 'web.job.kind.analyse')}</span
          >
        </div>
        <h1 class="mono">{job.path}</h1>
        <p class="muted">
          {t('web.job.title', { id: shortId(job.id) })}
          {#if job.summary}· {t('web.job.meta.files', { count: total(job.summary) })}{/if}
          {#if job.finishedAt}· {t('web.job.meta.finished', {
              date: formatDate(job.finishedAt, locale.value),
            })}{/if}
        </p>
      </div>
      <div class="resend">
        <button
          type="button"
          class="btn"
          class:btn-primary={job.status === 'failed'}
          disabled={resending || job.status === 'queued' || job.status === 'running'}
          onclick={() => void resend()}>{t('web.job.resend')}</button
        >
        <span class="muted">{t('web.job.resend.hint')}</span>
      </div>
    </header>

    {#if resent}
      <p class="alert notice" role="status">
        {t('web.job.resent', { id: shortId(resent) })}
        <Link href={`/jobs/${resent}`}>{t('web.job.resent.follow')}</Link>
      </p>
    {/if}
    {#if resendFailure}
      <p class="alert alert-danger" role="alert">{messageOf(t, resendFailure)}</p>
    {/if}

    <div class="columns">
      <div class="main">
        {#each [{ error: job.error, label: 'web.job.cause' }, { error: job.execution?.status === 'failed' ? job.execution.error : null, label: 'web.job.cause.transfer' }] as cause (cause.label)}
          {#if cause.error}
            <section class="card cause" role="alert" aria-labelledby={cause.label}>
              <span class="eyebrow danger-text" id={cause.label}
                >{t(cause.label as 'web.job.cause')}</span
              >
              <h2>{describe(cause.error)}</h2>
              <p class="muted">{t('web.home.jobs.failed.hint')}</p>
              <div class="actions">
                {#if cause.error.code === 'tmdb.invalid-key'}
                  <Link href="/settings" class="btn">{t('web.home.jobs.failed.settings')}</Link>
                {/if}
                <button
                  type="button"
                  class="link"
                  aria-expanded={showTech}
                  onclick={() => (showTech = !showTech)}
                >
                  {t(showTech ? 'web.job.tech.hide' : 'web.job.tech.show')}
                </button>
              </div>
              {#if showTech}
                <pre class="tech">{JSON.stringify(cause.error, null, 2)}</pre>
              {/if}
            </section>
          {/if}
        {/each}

        {#if job.status === 'done' && job.summary && job.summary['to-rename'] > 0 && job.execution === null}
          <section
            class="card transfer"
            aria-label={t('web.job.transfer', { count: job.summary['to-rename'] })}
          >
            <button
              type="button"
              class="btn btn-primary"
              disabled={transferring}
              onclick={() => void transfer()}
            >
              {t('web.job.transfer', { count: job.summary['to-rename'] })}
            </button>
            <span class="muted">
              {t('web.job.transfer.hint', {
                mode: job.settings ? t(`web.history.mode.${job.settings.mode}`) : '',
              })}
            </span>
          </section>
        {/if}
        {#if transferStarted}
          <p class="alert notice" role="status">
            {t('web.job.transfer.started')}
            {#if batchId}<Link href={`/history/${batchId}`}>{t('web.job.links.batch')}</Link>{/if}
          </p>
        {/if}

        {#if job.summary}
          <section aria-labelledby="summary-title">
            <div class="row">
              <h2 id="summary-title">{t('web.job.summary.title')}</h2>
              <span class="muted">{t('web.job.summary.hint')}</span>
            </div>
            <div class="tiles">
              {#each CLASSIFICATIONS as name (name)}
                <div class="card tile" class:on={filter === name}>
                  <button
                    type="button"
                    aria-pressed={filter === name}
                    onclick={() => void pick(name)}
                  >
                    <span class="muted">{t(`web.job.class.${name}`)}</span>
                    <strong>{job.summary[name]}</strong>
                    <span class="detail">{t(`web.job.class.${name}.detail`)}</span>
                  </button>
                </div>
              {/each}
            </div>
          </section>

          <section class="card files" aria-labelledby="files-title">
            <div class="row">
              <h2 id="files-title">
                {t('web.job.files.title', {
                  filter: filter ? t(`web.job.class.${filter}`) : t('web.job.files.all'),
                })}
              </h2>
              {#if filter}
                <button type="button" class="btn" onclick={() => void pick(filter)}>
                  {t('web.job.files.clear')}
                </button>
              {/if}
            </div>
            {#if files.length === 0}
              <p class="muted pad">
                {t(total(job.summary) === 0 ? 'web.job.files.none' : 'web.job.files.empty')}
              </p>
            {:else}
              <div class="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t('web.job.col.file')}</th>
                      <th>{t('web.job.col.classification')}</th>
                      <th>{t('web.job.col.result')}</th>
                      <th>{t('web.job.col.next')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each files as file (file.id)}
                      {@const next = followUp(file)}
                      <tr>
                        <td class="mono" title={file.path}>{releaseName(file.path)}</td>
                        <td>{t(`web.job.class.${file.classification}`)}</td>
                        <td>
                          {resultOf(file)}
                          {#if file.error}<span class="danger-text">· {describe(file.error)}</span
                            >{/if}
                        </td>
                        <td>
                          {#if next}
                            <Link href={next.href}
                              >{t(
                                next.kind === 'batch' ? 'web.job.next.batch' : 'web.job.next.queue',
                              )}</Link
                            >
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
              {#if more}
                <div class="pad">
                  <button type="button" class="btn" onclick={() => void loadFiles(true)}>
                    {t('web.job.files.more')}
                  </button>
                </div>
              {/if}
            {/if}
          </section>
        {/if}
      </div>

      <aside class="side">
        <section class="card" aria-labelledby="timeline-title">
          <h2 id="timeline-title">{t('web.job.timeline')}</h2>
          <ol class="timeline">
            <li>
              <strong>{t('web.job.timeline.created')}</strong><span class="muted"
                >{formatDate(job.createdAt, locale.value)}</span
              >
            </li>
            {#if job.startedAt}
              <li>
                <strong>{t('web.job.timeline.started')}</strong><span class="muted"
                  >{time(job.startedAt)}</span
                >
              </li>
            {/if}
            {#if job.finishedAt}
              <li>
                <strong class:danger-text={job.status === 'failed'}
                  >{t(
                    job.status === 'failed' ? 'web.job.timeline.failed' : 'web.job.timeline.done',
                  )}</strong
                >
                <span class="muted"
                  >{time(job.finishedAt)}{#if duration}
                    · {t('web.job.timeline.duration', { duration })}{/if}</span
                >
              </li>
            {/if}
          </ol>
        </section>

        <section class="card" aria-labelledby="settings-title">
          <h2 id="settings-title">{t('web.job.settings.title')}</h2>
          {#if job.settings && roots}
            <dl>
              <dt class="muted">{t('web.job.settings.profile')}</dt>
              <dd>
                {job.settings.profile}{#if driftOf('profile')}
                  <span class="chip chip-warn"
                    >{t('web.job.settings.drift', { value: driftOf('profile') ?? '' })}</span
                  >{/if}
              </dd>
              <dt class="muted">{t('web.job.settings.mode')}</dt>
              <dd>
                {t(`web.history.mode.${job.settings.mode}`)}{#if driftOf('mode')}
                  <span class="chip chip-warn"
                    >{t('web.job.settings.drift', {
                      value: t(`web.history.mode.${driftOf('mode') as 'copy'}`),
                    })}</span
                  >{/if}
              </dd>
              <dt class="muted">{t('web.job.settings.movies')}</dt>
              <dd class="mono">
                {roots.movies}{#if driftOf('movies')}
                  <span class="chip chip-warn"
                    >{t('web.job.settings.drift', { value: driftOf('movies') ?? '' })}</span
                  >{/if}
              </dd>
              <dt class="muted">{t('web.job.settings.series')}</dt>
              <dd class="mono">
                {roots.series}{#if driftOf('series')}
                  <span class="chip chip-warn"
                    >{t('web.job.settings.drift', { value: driftOf('series') ?? '' })}</span
                  >{/if}
              </dd>
            </dl>
            <p class="muted note">
              {t(drift.length > 0 ? 'web.job.settings.frozen' : 'web.job.settings.same')}
            </p>
          {:else}
            <p class="muted">{t('web.job.settings.none')}</p>
          {/if}
        </section>

        {#if batchId || (job.summary && job.summary.conflict + job.summary.ambiguous + job.summary.unrecognized > 0)}
          <section class="card links" aria-labelledby="links-title">
            <h2 id="links-title">{t('web.job.links.title')}</h2>
            {#if batchId}
              <Link href={`/history/${batchId}`}>{t('web.job.links.batch')}</Link>
            {/if}
            <Link href="/queue">{t('web.job.links.queue')}</Link>
          </section>
        {/if}
      </aside>
    </div>
  {/if}
</div>

<style>
  .page,
  .main,
  .side {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .crumb {
    font-size: 13px;
  }

  .head,
  .row {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px 20px;
  }

  .head {
    align-items: flex-start;
  }

  .title {
    flex: 1 1 520px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .chips,
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 500;
    line-height: 1.4;
    word-break: break-all;
  }

  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .resend {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    font-size: 12px;
  }

  .notice {
    color: var(--ok);
    background: var(--ok-bg);
    border-color: var(--ok);
  }

  .columns {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    align-items: flex-start;
  }

  .main {
    flex: 2 1 600px;
    min-width: 0;
  }

  .side {
    flex: 1 1 300px;
    min-width: 0;
  }

  .transfer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 16px;
  }

  .cause {
    border-color: var(--danger);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .eyebrow {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .danger-text {
    color: var(--danger);
  }

  .link {
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 13px;
    text-decoration: underline;
    cursor: pointer;
    min-height: 44px;
  }

  .tech {
    margin: 0;
    padding: 12px 14px;
    border-radius: var(--radius-sm);
    background: var(--bg);
    border: 1px solid var(--border);
    font-family: var(--mono);
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 12px;
    margin-top: 12px;
  }

  .tile {
    padding: 0;
    border-width: 2px;
  }

  .tile.on {
    border-color: var(--accent);
  }

  .tile button {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    padding: 16px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .tile strong {
    font-size: 26px;
    font-weight: 800;
  }

  .detail {
    font-size: 12.5px;
    line-height: 1.45;
  }

  .files {
    padding: 0;
    overflow: hidden;
  }

  .files .row {
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }

  .pad {
    padding: 16px 20px;
    margin: 0;
  }

  .scroll {
    overflow-x: auto;
  }

  table {
    width: 100%;
    min-width: 640px;
    border-collapse: collapse;
    font-size: 13px;
  }

  th {
    padding: 10px 20px;
    text-align: left;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
  }

  td {
    padding: 12px 20px;
    border-bottom: 1px solid var(--surface-2);
    vertical-align: top;
  }

  td.mono {
    word-break: break-all;
  }

  .side .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .timeline {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .timeline li {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  dl {
    display: grid;
    grid-template-columns: 90px minmax(0, 1fr);
    gap: 10px 12px;
    margin: 0;
    font-size: 13px;
  }

  dd {
    margin: 0;
    word-break: break-all;
  }

  .note {
    margin: 0;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    font-size: 12.5px;
  }

  .links {
    font-size: 14px;
  }
</style>
