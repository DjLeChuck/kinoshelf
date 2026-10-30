<script lang="ts">
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import type { StepId } from '../lib/onboarding.js';
  import { FormError, isHttpUrl, nullIfBlank } from '../lib/settings.js';
  import { shell } from '../lib/shell-state.svelte.js';
  import Link from './Link.svelte';
  import PathField from './PathField.svelte';

  let { step }: { step: StepId } = $props();

  let tmdbKey = $state('');
  let kind = $state<'plex' | 'jellyfin'>('plex');
  let url = $state('');
  let token = $state('');
  let folder = $state('');
  let busy = $state(false);
  let failure = $state<unknown>(undefined);

  const needsAbsolute = (path: string): boolean => path.startsWith('/');

  /** Each step saves what it owns, the way the settings do, so the two can never disagree. */
  async function save(): Promise<void> {
    switch (step) {
      case 'tmdb':
        await api.patch('/api/settings', { tmdb: { apiKey: tmdbKey.trim() } });
        tmdbKey = '';
        break;
      case 'server':
        if (!isHttpUrl(url.trim())) {
          throw new FormError(t('web.settings.invalid.url'));
        }
        await api.patch('/api/settings', {
          [kind]: { url: url.trim(), ...(token.trim() !== '' && { token: nullIfBlank(token) }) },
        });
        break;
      case 'destination':
        if (!needsAbsolute(folder.trim())) {
          throw new FormError(t('web.settings.invalid.watch-folders'));
        }
        await api.patch('/api/settings', { processing: { destination: folder.trim() } });
        break;
      case 'source':
        if (!needsAbsolute(folder.trim())) {
          throw new FormError(t('web.settings.invalid.watch-folders'));
        }
        await api.post('/api/jobs', { path: folder.trim() });
        break;
    }
    // The step ticks itself: ask again rather than guess what the server now settles.
    await shell.loadOnboarding();
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    failure = undefined;
    try {
      await save();
    } catch (error) {
      failure = error;
    } finally {
      busy = false;
    }
  }
</script>

<form onsubmit={submit}>
  {#if step === 'tmdb'}
    <div class="field">
      <label for="ob-tmdb">{t('web.onboarding.form.tmdb.key')}</label>
      <input
        id="ob-tmdb"
        class="input mono"
        type="password"
        autocomplete="off"
        required
        bind:value={tmdbKey}
        aria-describedby="ob-tmdb-hint"
      />
      <span id="ob-tmdb-hint" class="muted hint">{t('web.onboarding.form.tmdb.hint')}</span>
    </div>
  {:else if step === 'server'}
    <div class="field">
      <label for="ob-kind">{t('web.onboarding.form.server.kind')}</label>
      <select id="ob-kind" class="input" bind:value={kind}>
        <option value="plex">Plex</option>
        <option value="jellyfin">Jellyfin</option>
      </select>
    </div>
    <div class="field">
      <label for="ob-url">{t('web.settings.server.url')}</label>
      <input
        id="ob-url"
        class="input mono"
        type="url"
        required
        placeholder={kind === 'plex' ? 'http://plex:32400' : 'http://jellyfin:8096'}
        bind:value={url}
      />
    </div>
    <div class="field">
      <label for="ob-token">{t('web.settings.server.token')}</label>
      <input
        id="ob-token"
        class="input mono"
        type="password"
        autocomplete="off"
        bind:value={token}
      />
    </div>
  {:else}
    {@const which = step === 'destination' ? 'destination' : 'source'}
    <div class="field">
      <label for="ob-folder">{t(`web.onboarding.form.${which}`)}</label>
      <PathField id="ob-folder" bind:value={folder} placeholder="/" />
      <span class="muted hint">{t(`web.onboarding.form.${which}.hint`)}</span>
    </div>
  {/if}

  {#if failure}
    <p class="alert alert-danger" role="alert">
      {failure instanceof FormError ? failure.message : messageOf(t, failure)}
    </p>
  {/if}

  <div class="actions">
    <button type="submit" class="btn btn-primary" disabled={busy}>
      {busy
        ? t('web.settings.saving')
        : step === 'source'
          ? t('web.onboarding.form.source.submit')
          : t('web.settings.save')}
    </button>
    {#if step !== 'source'}
      <Link href="/settings" class="more">{t('web.onboarding.form.more')}</Link>
    {/if}
  </div>
</form>

<style>
  form {
    display: flex;
    flex: 1 1 100%;
    flex-direction: column;
    gap: 12px;
    max-width: 520px;
    padding-top: 4px;
  }

  .hint {
    font-size: 12px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
  }
</style>
