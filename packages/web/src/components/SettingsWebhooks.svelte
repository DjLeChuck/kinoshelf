<script lang="ts">
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import {
    FormError,
    WEBHOOK_EVENTS,
    WEBHOOK_FORMATS,
    isHttpUrl,
    webhookRows,
    webhooksPatch,
    type Settings,
    type TestResult,
    type WebhookRow,
  } from '../lib/settings.js';
  import SettingsSection from './SettingsSection.svelte';

  let { settings, save }: { settings: Settings; save: (patch: object) => Promise<void> } = $props();

  // Read once: the page replaces nothing under a form being edited.
  /* svelte-ignore state_referenced_locally */
  let rows = $state<WebhookRow[]>(webhookRows(settings.webhooks));
  let testing = $state(false);
  let results = $state<readonly TestResult[] | undefined>(undefined);
  let testFailure = $state<unknown>(undefined);

  async function submit(): Promise<void> {
    for (const row of rows) {
      if (row.id === undefined && row.url.trim() !== '' && !isHttpUrl(row.url.trim())) {
        throw new FormError(t('web.settings.invalid.url'));
      }
    }
    await save({ webhooks: webhooksPatch(rows) });
  }

  // `settings` is replaced by the page after a save: the rows follow it.
  /* svelte-ignore state_referenced_locally */
  let lastSeen = settings.webhooks;
  $effect(() => {
    if (settings.webhooks !== lastSeen) {
      lastSeen = settings.webhooks;
      rows = webhookRows(settings.webhooks);
    }
  });

  function toggle(row: WebhookRow, event: (typeof WEBHOOK_EVENTS)[number], checked: boolean): void {
    row.on = checked ? [...row.on, event] : row.on.filter((e) => e !== event);
  }

  async function test(): Promise<void> {
    testing = true;
    testFailure = undefined;
    try {
      results = await api.post<TestResult[]>('/api/notifications/test');
    } catch (error) {
      testFailure = error;
    } finally {
      testing = false;
    }
  }
</script>

<SettingsSection title={t('web.settings.webhooks.title')} onsubmit={submit}>
  <p class="muted hint">{t('web.settings.webhooks.hint')}</p>

  {#if rows.length === 0}
    <p class="muted">{t('web.settings.webhooks.empty')}</p>
  {/if}

  {#each rows as row, index (row.id ?? `new-${index}`)}
    <fieldset>
      {#if row.id !== undefined}
        <p class="mono">{t('web.settings.webhooks.kept', { target: row.target ?? '' })}</p>
      {:else}
        <div class="field">
          <label for="hook-url-{index}">{t('web.settings.webhooks.url')}</label>
          <input
            id="hook-url-{index}"
            class="input mono"
            type="url"
            placeholder="https://"
            bind:value={row.url}
          />
        </div>
      {/if}

      <div class="field">
        <label for="hook-format-{index}">{t('web.settings.webhooks.format')}</label>
        <select id="hook-format-{index}" class="input" bind:value={row.format}>
          {#each WEBHOOK_FORMATS as format (format)}
            <option value={format}>{format}</option>
          {/each}
        </select>
        <span class="muted hint">{t(`web.settings.webhooks.format.${row.format}.help`)}</span>
      </div>

      <div class="events" role="group" aria-label={t('web.settings.webhooks.on')}>
        <span class="muted">{t('web.settings.webhooks.on')}</span>
        {#each WEBHOOK_EVENTS as event (event)}
          <label class="check">
            <input
              type="checkbox"
              checked={row.on.includes(event)}
              onchange={(e) => {
                toggle(row, event, e.currentTarget.checked);
              }}
            />
            {t(`web.settings.webhooks.on.${event}`)}
          </label>
        {/each}
      </div>

      <button
        type="button"
        class="btn"
        onclick={() => {
          rows = rows.filter((_, i) => i !== index);
        }}>{t('web.settings.remove')}</button
      >
    </fieldset>
  {/each}

  <button
    type="button"
    class="btn add"
    onclick={() => {
      rows = [...rows, { url: '', format: 'generic', on: ['transferred', 'failed'] }];
    }}>{t('web.settings.webhooks.add')}</button
  >

  {#snippet actions()}
    <button type="button" class="btn" disabled={testing} onclick={() => void test()}>
      {testing ? t('web.settings.webhooks.testing') : t('web.settings.webhooks.test')}
    </button>
  {/snippet}

  {#if testFailure}
    <p class="alert alert-danger" role="alert">{messageOf(t, testFailure)}</p>
  {:else if results}
    <div role="status" aria-label={t('web.settings.webhooks.test.results')}>
      {#if results.length === 0}
        <p class="muted">{t('web.settings.webhooks.test.none')}</p>
      {:else}
        <ul class="results">
          {#each results as result (`${result.kind}-${result.target}`)}
            <li>
              <span class="chip {result.ok ? 'chip-ok' : 'chip-danger'}">
                {result.ok
                  ? t('web.settings.webhooks.test.ok')
                  : t('web.settings.webhooks.test.failed')}
              </span>
              <span class="mono">{result.kind} · {result.target}</span>
              {#if result.error}<span class="muted">{result.error}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</SettingsSection>

<style>
  fieldset {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  fieldset .btn {
    align-self: flex-start;
  }

  .events {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 16px;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
  }

  .add {
    align-self: flex-start;
  }

  .hint {
    font-size: 12px;
  }

  .results {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .results li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
</style>
