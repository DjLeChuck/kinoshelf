<script lang="ts">
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import { nullIfBlank, type Settings } from '../lib/settings.js';
  import SettingsSection from './SettingsSection.svelte';

  let { settings, save }: { settings: Settings; save: (patch: object) => Promise<void> } = $props();

  // Read once: the page replaces nothing under a form being edited.
  /* svelte-ignore state_referenced_locally */
  let language = $state(settings.tmdb.language ?? '');
  /* svelte-ignore state_referenced_locally */
  let locale = $state<string>(settings.locale ?? '');
  let key = $state('');
  let testing = $state(false);
  /** What the test said, as text; `undefined` before any test. */
  let verdict = $state<{ ok: boolean; text: string } | undefined>(undefined);

  const source = $derived(settings.tmdb.source ?? 'none');

  async function submit(): Promise<void> {
    await save({
      tmdb: { language: nullIfBlank(language), ...(key.trim() !== '' && { apiKey: key.trim() }) },
      locale: locale === '' ? null : locale,
    });
    key = '';
  }

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
</script>

<SettingsSection title={t('web.settings.general.title')} onsubmit={submit}>
  <p class="muted" role="status">{t(`web.settings.tmdb.status.${source}`)}</p>

  <div class="field">
    <label for="tmdb-key">{t('web.settings.tmdb.key')}</label>
    <input
      id="tmdb-key"
      class="input mono"
      type="password"
      autocomplete="off"
      bind:value={key}
      aria-describedby="tmdb-key-hint"
    />
    <span id="tmdb-key-hint" class="muted hint">{t('web.settings.tmdb.key.hint')}</span>
  </div>

  <div class="field">
    <label for="metadata-language">{t('web.settings.general.metadata')}</label>
    <input id="metadata-language" class="input" bind:value={language} placeholder="fr" />
    <span class="muted hint">{t('web.settings.general.metadata.hint')}</span>
  </div>

  <div class="field">
    <label for="server-locale">{t('web.settings.general.locale')}</label>
    <select id="server-locale" class="input" bind:value={locale}>
      <option value="">{t('web.settings.unset')}</option>
      <option value="fr">Français</option>
      <option value="en">English</option>
    </select>
    <span class="muted hint">{t('web.settings.general.locale.hint')}</span>
  </div>

  {#snippet actions()}
    <button
      type="button"
      class="btn"
      disabled={testing || !settings.tmdb.configured}
      onclick={() => void test()}
    >
      {testing ? t('web.settings.tmdb.testing') : t('web.settings.tmdb.test')}
    </button>
  {/snippet}
  {#if verdict}
    <p class={verdict.ok ? 'ok' : 'alert alert-danger'} role="status">{verdict.text}</p>
  {/if}
</SettingsSection>

<style>
  .hint {
    font-size: 12px;
  }

  .ok {
    color: var(--ok);
  }
</style>
