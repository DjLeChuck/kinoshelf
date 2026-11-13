<script lang="ts">
  import { api } from '../lib/api.js';
  import { copyText } from '../lib/clipboard.js';
  import { issueUrl, versionsText, type Diagnostic } from '../lib/diagnostic.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import { resource } from '../lib/resource.svelte.js';

  const diagnostic = resource<Diagnostic>(
    () => api.get<Diagnostic>('/api/diagnostic'),
    ['settings', 'ready'],
  );
  const data = $derived(diagnostic.value);

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

  <section class="card">
    <h2>{t('web.diagnostic.title')}</h2>
    <p class="muted">{t('web.diagnostic.intro')}</p>
    <ul class="contents">
      <li>{t('web.diagnostic.file.summary')}</li>
      <li>{t('web.diagnostic.file.config')}</li>
      <li>{t('web.diagnostic.file.health')}</li>
      <li>{t('web.diagnostic.file.tmdb')}</li>
      <li>
        {t('web.diagnostic.file.logs', { count: data?.logLines ?? 2000 })}
      </li>
    </ul>
    <p class="muted">{t('web.diagnostic.secrets')}</p>
    <div class="actions">
      <a class="btn btn-primary" href="/api/diagnostic/archive" download>
        {t('web.diagnostic.download')}
      </a>
    </div>
  </section>

  {#if data}
    <section class="card" aria-labelledby="diag-preview">
      <h2 id="diag-preview">{t('web.diagnostic.config.title')}</h2>
      <p class="muted">{t('web.diagnostic.config.hint')}</p>
      <details>
        <summary>{t('web.diagnostic.config.show')}</summary>
        <pre class="mono">{JSON.stringify(data.config, null, 2)}</pre>
      </details>
    </section>

    <section class="card" aria-labelledby="diag-issue">
      <h2 id="diag-issue">{t('web.diagnostic.issue.title')}</h2>
      <p class="muted">{t('web.diagnostic.issue.hint')}</p>
      <pre class="mono">{versionsText(data.summary)}</pre>
      <div class="actions">
        <button type="button" class="btn" onclick={copyVersions}>
          {copied === 'done' ? t('web.diagnostic.copied') : t('web.diagnostic.copy')}
        </button>
        <a
          class="btn"
          href={issueUrl(data.summary, t('web.diagnostic.issue.reminder'))}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('web.diagnostic.issue.open')}
        </a>
        {#if copied === 'failed'}<span class="muted" role="status">{t('web.logs.copy-failed')}</span
          >{/if}
      </div>
    </section>
  {:else if !diagnostic.failure}
    <p class="muted" role="status">{t('web.loading')}</p>
  {/if}
</div>

<style>
  .diagnostic {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 760px;
  }

  .card {
    gap: 12px;
  }

  h2 {
    font-size: 16px;
    margin: 0;
  }

  .contents {
    margin: 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
  }

  details summary {
    cursor: pointer;
    min-height: 32px;
  }

  pre {
    margin: 8px 0 0;
    padding: 12px;
    overflow: auto;
    max-height: 420px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 12px;
  }
</style>
