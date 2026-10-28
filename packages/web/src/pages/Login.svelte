<script lang="ts">
  import Logo from '../components/Logo.svelte';
  import { ApiError } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import { session } from '../lib/session.svelte.js';

  let apiKey = $state('');
  let failure = $state<unknown>(undefined);
  let busy = $state(false);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    failure = undefined;
    try {
      await session.signIn(apiKey.trim());
    } catch (error) {
      failure = error;
    } finally {
      busy = false;
    }
  }
</script>

<main>
  <form class="card" onsubmit={submit}>
    <Logo height={32} />
    <div>
      <h1>{t('web.login.title')}</h1>
      <p class="muted">{t('web.login.intro')}</p>
    </div>

    <div class="field">
      <label for="api-key">{t('web.login.key')}</label>
      <!-- A password field: the key is a secret, and a password manager can fill it. -->
      <input
        id="api-key"
        class="input mono"
        type="password"
        autocomplete="current-password"
        required
        bind:value={apiKey}
        aria-invalid={failure ? 'true' : undefined}
        aria-describedby={failure ? 'login-error' : undefined}
      />
    </div>

    {#if failure}
      <p id="login-error" class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
    {/if}

    <button type="submit" class="btn btn-primary" disabled={busy || apiKey.trim() === ''}>
      {t('web.login.submit')}
    </button>
    <p class="muted hint">
      {failure instanceof ApiError && failure.code === 'auth.not-configured'
        ? ''
        : t('web.login.hint')}
    </p>
  </form>
</main>

<style>
  main {
    display: grid;
    place-items: center;
    min-height: 100vh;
    padding: 24px 16px;
  }

  form {
    width: min(100%, 400px);
  }

  h1 {
    font-size: 20px;
    margin-bottom: 4px;
  }

  .hint {
    font-size: 12px;
  }
</style>
