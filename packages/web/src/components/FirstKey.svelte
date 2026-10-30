<script lang="ts">
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import { session } from '../lib/session.svelte.js';
  import Logo from './Logo.svelte';

  /** `undefined` until generated; the page never gets it again once it is left. */
  let key = $state<string | undefined>(undefined);
  let noted = $state(false);
  let copied = $state(false);
  let busy = $state(false);
  let failure = $state<unknown>(undefined);

  async function generate(): Promise<void> {
    busy = true;
    failure = undefined;
    try {
      ({ apiKey: key } = await api.post<{ apiKey: string }>('/api/setup/api-key'));
    } catch (error) {
      failure = error;
      // Someone else created it meanwhile: there is nothing left to offer but the sign-in.
      session.endSetup();
    } finally {
      busy = false;
    }
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(key ?? '');
      copied = true;
    } catch {
      // Clipboard denied (plain http): the key is selectable, copying by hand still works.
    }
  }
</script>

<section class="card">
  <Logo height={32} />
  <div>
    <h1>{t('web.login.setup.title')}</h1>
    <p class="muted">{t('web.login.setup.intro')}</p>
  </div>

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {/if}

  {#if key === undefined}
    <button type="button" class="btn btn-primary" disabled={busy} onclick={() => void generate()}>
      {busy ? t('web.login.setup.generating') : t('web.login.setup.generate')}
    </button>
  {:else}
    <div class="field">
      <label for="first-key">{t('web.login.setup.key')}</label>
      <div class="row">
        <input
          id="first-key"
          class="input mono"
          readonly
          value={key}
          onfocus={(e) => {
            e.currentTarget.select();
          }}
        />
        <button type="button" class="btn" onclick={() => void copy()}>
          {copied ? t('web.login.setup.copied') : t('web.login.setup.copy')}
        </button>
      </div>
    </div>
    <p class="alert warning" role="status">{t('web.login.setup.warning')}</p>
    <label class="check">
      <input type="checkbox" bind:checked={noted} />
      {t('web.login.setup.noted')}
    </label>
    <button
      type="button"
      class="btn btn-primary"
      disabled={!noted}
      onclick={() => {
        session.endSetup();
      }}
    >
      {t('web.login.setup.continue')}
    </button>
  {/if}
</section>

<style>
  section {
    width: min(100%, 440px);
  }

  h1 {
    font-size: 20px;
    margin-bottom: 4px;
  }

  /* The one thing on this page that cannot be recovered: it has to stand out. */
  .warning {
    margin: 0;
    border-color: var(--warn);
    background: var(--warn-bg);
    color: var(--warn);
    font-weight: 600;
    line-height: 1.5;
  }

  .row {
    display: flex;
    gap: 8px;
  }

  .row .input {
    flex: 1;
    min-width: 0;
  }
</style>
