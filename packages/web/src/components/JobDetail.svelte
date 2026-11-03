<script lang="ts">
  import Link from './Link.svelte';
  import { describeError } from '@kinoshelf/i18n';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import {
    STATUS_CHIP,
    analysed,
    formatDate,
    formatDuration,
    resendRequest,
    rootsOf,
    shortId,
    type JobDetail,
  } from '../lib/history.js';
  import { libraryApi } from '../lib/libraries.js';
  import { router } from '../lib/router.svelte.js';
  import type { ErrorBody } from '../lib/arrivals.js';

  let {
    id,
    embedded = false,
  }: {
    id: string;
    /** Inside a batch's detail, which already says what was submitted: no title. */
    embedded?: boolean;
  } = $props();

  let job = $state<JobDetail | undefined>(undefined);
  let failure = $state<unknown>(undefined);
  let showTech = $state(false);
  let resending = $state(false);
  let resendFailure = $state<unknown>(undefined);

  // The parent keys this component on the job, so `id` does not change during its life.
  refetchOn(['jobs', 'history', 'ready'], () => void load());

  async function load(): Promise<void> {
    try {
      job = await api.get<JobDetail>(`/api/jobs/${id}`);
      failure = undefined;
    } catch (error) {
      failure = error;
    }
  }

  async function resend(): Promise<void> {
    if (!job) {
      return;
    }
    resending = true;
    resendFailure = undefined;
    try {
      const { url, body } = resendRequest(job, await libraryApi.list());
      const created = await api.post<{ id: string }>(url, body);
      // The new job is the line to follow: the list picks it up and this page leaves the old one.
      router.navigate(`/history/${created.id}`);
    } catch (error) {
      resendFailure = error;
    } finally {
      resending = false;
    }
  }

  // A failure the server stored (the job's, a file's) is a code and its parameters, not a thrown
  // ApiError: `messageOf` would only say something went wrong.
  const describe = (error: ErrorBody): string => describeError(t, error);

  const duration = $derived(
    job?.startedAt && job.finishedAt ? formatDuration(job.startedAt, job.finishedAt) : undefined,
  );
  const roots = $derived(job?.settings ? rootsOf(job.settings.destinationRoot) : undefined);
  // The analysis failed, or it went well and its transfer did not.
  const causes = $derived(
    job
      ? [
          { error: job.error, label: 'web.history.job.cause' as const },
          {
            error: job.execution?.status === 'failed' ? job.execution.error : null,
            label: 'web.history.job.cause.transfer' as const,
          },
        ].filter((cause): cause is { error: ErrorBody; label: typeof cause.label } => !!cause.error)
      : [],
  );
</script>

{#if failure && !job}
  <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
{:else if job}
  <article class={embedded ? 'embedded' : 'card'}>
    <header>
      <div>
        {#if !embedded}
          <h2 class="mono">{job.path}</h2>
        {/if}
        <p class="muted">
          {t('web.history.job.title', { id: shortId(job.id) })}
          · {t(job.apply ? 'web.history.job.apply' : 'web.history.job.analyse')}
          {#if job.summary}· {t('web.history.job.files', { count: analysed(job.summary) })}{/if}
          {#if job.finishedAt}· {formatDate(job.finishedAt, locale.value)}{/if}
          {#if duration}· {t('web.history.job.duration', { duration })}{/if}
        </p>
      </div>
      <span class="chip {STATUS_CHIP[job.status]}">{t(`web.history.status.${job.status}`)}</span>
    </header>

    {#each causes as cause (cause.label)}
      <section class="cause" role="alert" aria-labelledby={cause.label}>
        <h3 id={cause.label}>{t(cause.label)}</h3>
        <p class="alert alert-danger">{describe(cause.error)}</p>
        <p class="muted">{t('web.history.job.cause.hint')}</p>
        <div class="actions">
          {#if cause.error.code === 'tmdb.invalid-key'}
            <Link href="/settings" class="btn">{t('web.history.job.settings')}</Link>
          {/if}
          <button
            type="button"
            class="link"
            aria-expanded={showTech}
            onclick={() => (showTech = !showTech)}
          >
            {t(showTech ? 'web.history.job.tech.hide' : 'web.history.job.tech.show')}
          </button>
        </div>
        {#if showTech}
          <pre class="tech">{JSON.stringify(cause.error, null, 2)}</pre>
        {/if}
      </section>
    {/each}

    {#if job.settings && roots}
      <section aria-labelledby="settings-title-{job.id}">
        <h3 id="settings-title-{job.id}">{t('web.history.job.used')}</h3>
        <dl>
          <dt>{t('web.history.job.used.profile')}</dt>
          <dd class="mono">{job.settings.profile}</dd>
          <dt>{t('web.history.job.used.mode')}</dt>
          <dd>{t(`web.history.mode.${job.settings.mode}`)}</dd>
          {#if roots.movies === roots.series}
            <dt>{t('web.history.job.used.destination')}</dt>
            <dd class="mono">{roots.movies}</dd>
          {:else}
            <dt>{t('web.history.job.used.movies')}</dt>
            <dd class="mono">{roots.movies}</dd>
            <dt>{t('web.history.job.used.series')}</dt>
            <dd class="mono">{roots.series}</dd>
          {/if}
        </dl>
      </section>
    {/if}

    {#if resendFailure}
      <p class="alert alert-danger" role="alert">{messageOf(t, resendFailure)}</p>
    {/if}

    {#if job.status === 'failed' || job.execution?.status === 'failed'}
      <footer>
        <button
          type="button"
          class="btn btn-primary"
          disabled={resending}
          onclick={() => void resend()}>{t('web.history.job.resend')}</button
        >
        <span class="muted">{t('web.history.job.resend.hint')}</span>
      </footer>
    {/if}
  </article>
{:else}
  <p class="muted" role="status">{t('web.loading')}</p>
{/if}

<style>
  article {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  h2 {
    font-size: 16px;
    overflow-wrap: anywhere;
  }

  h3 {
    margin-bottom: 8px;
    font-size: 13px;
    color: var(--muted);
    font-weight: 600;
  }

  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 12px;
    margin: 0;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .actions,
  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }

  .tech {
    margin: 8px 0 0;
    padding: 10px 12px;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 12px;
  }
</style>
