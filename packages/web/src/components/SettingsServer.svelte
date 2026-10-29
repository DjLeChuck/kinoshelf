<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import {
    FormError,
    cleanMappings,
    isHttpUrl,
    nullIfBlank,
    type PathMapping,
    type Settings,
  } from '../lib/settings.js';
  import PathMappings from './PathMappings.svelte';
  import SettingsSection from './SettingsSection.svelte';

  let {
    kind,
    settings,
    save,
  }: {
    kind: 'plex' | 'jellyfin';
    settings: Settings;
    save: (patch: object) => Promise<void>;
  } = $props();

  // Read once: the page replaces nothing under a form being edited.
  /* svelte-ignore state_referenced_locally */
  const current = settings[kind];
  /* svelte-ignore state_referenced_locally */
  const isPlex = kind === 'plex';
  let enabled = $state(current !== null);
  let url = $state(current?.url ?? '');
  /* svelte-ignore state_referenced_locally */
  const savedSection = settings.plex?.section ?? null;
  let section = $state(savedSection === null ? '' : String(savedSection));
  let token = $state('');
  let paths = $state<PathMapping[]>(current ? current.paths.map((p) => ({ ...p })) : []);

  async function submit(): Promise<void> {
    if (!enabled) {
      await save({ [kind]: null });
      url = '';
      return;
    }
    if (!isHttpUrl(url.trim())) {
      throw new FormError(t('web.settings.invalid.url'));
    }
    await save({
      [kind]: {
        url: url.trim(),
        paths: cleanMappings(paths),
        ...(isPlex && { section: section.trim() === '' ? null : Number(section) }),
        ...(token.trim() !== '' && { token: nullIfBlank(token) }),
      },
    });
    token = '';
  }
</script>

<SettingsSection title={t(`web.settings.${kind}.title`)} onsubmit={submit}>
  <label class="check">
    <input type="checkbox" bind:checked={enabled} />
    {t('web.settings.server.enabled')}
  </label>

  {#if enabled}
    <div class="field">
      <label for="{kind}-url">{t('web.settings.server.url')}</label>
      <input
        id="{kind}-url"
        class="input mono"
        type="url"
        required
        placeholder={isPlex ? 'http://plex:32400' : 'http://jellyfin:8096'}
        bind:value={url}
      />
    </div>

    {#if isPlex}
      <div class="field">
        <label for="plex-section">{t('web.settings.server.section')}</label>
        <input
          id="plex-section"
          class="input"
          inputmode="numeric"
          pattern="[0-9]+"
          bind:value={section}
        />
      </div>
    {/if}

    <div class="field">
      <label for="{kind}-token">{t('web.settings.server.token')}</label>
      <input
        id="{kind}-token"
        class="input mono"
        type="password"
        autocomplete="off"
        bind:value={token}
      />
      {#if current?.tokenConfigured}
        <span class="muted hint">{t('web.settings.server.token.set')}</span>
      {/if}
    </div>

    <PathMappings bind:rows={paths} />
  {/if}
</SettingsSection>

<style>
  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
  }

  .hint {
    font-size: 12px;
  }
</style>
