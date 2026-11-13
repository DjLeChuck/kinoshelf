<script lang="ts">
  import { api } from '../lib/api.js';
  import { copyText } from '../lib/clipboard.js';
  import { issueUrl, versionsText, type Diagnostic } from '../lib/diagnostic.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import Chevron from './Chevron.svelte';

  const diagnostic = resource<Diagnostic>(
    () => api.get<Diagnostic>('/api/diagnostic'),
    ['settings', 'ready'],
  );
  const data = $derived(diagnostic.value);

  /** What the archive holds: a bold name, then what it says, in grey. */
  const CONTENTS = ['summary', 'config', 'health', 'tmdb', 'logs'] as const;

  let previewing = $state(false);
  let copied = $state<'done' | 'failed' | undefined>(undefined);
  async function copyVersions(): Promise<void> {
    if (data) {
      copied = (await copyText(versionsText(data.summary))) ? 'done' : 'failed';
    }
  }
</script>

<div class="diagnostic">
  {#if diagnostic.failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, diagnostic.failure)}</p>
  {/if}

  <section class="card main" aria-labelledby="diag-title">
    <h2 id="diag-title">{t('web.diagnostic.title')}</h2>
    <p class="intro">{t('web.diagnostic.intro')}</p>

    <ul class="contents">
      {#each CONTENTS as id (id)}
        <li>
          <svg
            class="tick"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg
          >
          <span>
            <b>{t(`web.diagnostic.file.${id}.name`)}</b><span class="muted"
              >{t(`web.diagnostic.file.${id}.what`, { count: data?.logLines ?? 2000 })}</span
            >
          </span>
        </li>
      {/each}
    </ul>

    {#if data}
      <div class="preview">
        <button
          type="button"
          class="toggle"
          aria-expanded={previewing}
          aria-controls="diag-config"
          onclick={() => (previewing = !previewing)}
        >
          <Chevron open={previewing} />{t('web.diagnostic.config.show')}
        </button>
        {#if previewing}
          <pre id="diag-config" class="code mono">{JSON.stringify(data.config, null, 2)}</pre>
        {/if}
      </div>
    {/if}

    <div class="actions">
      <a class="btn btn-primary" href="/api/diagnostic/archive" download>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 20h16" /></svg
        >
        {t('web.diagnostic.download')}
      </a>
    </div>
    <p class="note muted">{t('web.diagnostic.review')}</p>
  </section>

  <aside class="card side" aria-labelledby="issue-title">
    <h2 id="issue-title">{t('web.diagnostic.issue.title')}</h2>
    {#if data}
      <p>{t('web.diagnostic.issue.hint')}</p>
      <a
        class="btn"
        href={issueUrl(data.summary, t('web.diagnostic.issue.reminder'))}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('web.diagnostic.issue.open')}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" /></svg
        >
        <span class="sr-only">{t('web.diagnostic.issue.newtab')}</span>
      </a>
      <p class="note muted">{t('web.diagnostic.issue.versions')}</p>
      <pre class="code mono">{versionsText(data.summary)}</pre>
      <div class="actions">
        <button type="button" class="btn" onclick={copyVersions}>
          {copied === 'done' ? t('web.diagnostic.copied') : t('web.diagnostic.copy')}
        </button>
        {#if copied === 'failed'}<span class="muted" role="status">{t('web.logs.copy-failed')}</span
          >{/if}
      </div>
    {:else if !diagnostic.failure}
      <p class="muted" role="status">{t('web.loading')}</p>
    {/if}
  </aside>
</div>

<style>
  /* The archive on the left, the way to report on the right; they stack when narrow. */
  .diagnostic {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 16px;
  }

  .diagnostic > .alert {
    flex: 1 1 100%;
  }

  .card {
    gap: 16px;
    padding: 24px;
    min-width: 0;
  }

  .main {
    flex: 999 1 560px;
  }

  .side {
    flex: 1 1 300px;
    gap: 12px;
  }

  h2 {
    margin: 0;
    font-size: 17px;
  }

  .side h2 {
    font-size: 15px;
  }

  p {
    margin: 0;
  }

  .intro {
    max-width: 70ch;
  }

  .contents {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .contents li {
    display: flex;
    gap: 10px;
  }

  .tick {
    flex: none;
    margin-top: 2px;
    color: var(--ok);
  }

  .preview {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .toggle {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  /* Black in both themes: it is a file's content, not part of the page. */
  .code {
    margin: 0;
    padding: 14px 16px;
    overflow: auto;
    max-height: 420px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #101215;
    color: #e8e6e1;
    font-size: 12.5px;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
  }

  .side .btn {
    align-self: flex-start;
  }

  .note {
    font-size: 12px;
  }
</style>
