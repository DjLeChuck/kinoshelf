<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import {
    PLEX_GIVE_UP_MS,
    PLEX_POLL_MS,
    addressesOf,
    ownedServers,
    type PlexPin,
    type PlexServer,
  } from '../lib/plex.js';
  import type { Settings } from '../lib/settings.js';

  let {
    account = $bindable(null),
    url = $bindable(''),
  }: {
    account?: Settings['plexAccount'];
    /** The server's address: picking one of the account's servers fills it. */
    url?: string;
  } = $props();

  let pin = $state<PlexPin | undefined>(undefined);
  let failure = $state<unknown>(undefined);
  let timedOut = $state(false);
  let busy = $state(false);
  let servers = $state<readonly PlexServer[] | undefined>(undefined);
  let timer: ReturnType<typeof setInterval> | undefined;

  function stop(): void {
    clearInterval(timer);
    timer = undefined;
    pin = undefined;
  }
  onDestroy(stop);

  async function loadServers(): Promise<void> {
    try {
      ({ servers } = await api.get<{ servers: PlexServer[] }>('/api/plex/servers'));
    } catch (error) {
      failure = error;
    }
  }
  // Read once, on open: a signed-in account lists its servers without a click.
  if (account === 'signed-in') {
    void loadServers();
  }

  async function check(id: number): Promise<void> {
    try {
      const { done } = await api.get<{ done: boolean }>(`/api/plex/auth/${String(id)}`);
      if (done) {
        stop();
        account = 'signed-in';
        await loadServers();
      }
    } catch (error) {
      stop();
      failure = error;
    }
  }

  async function signIn(): Promise<void> {
    busy = true;
    failure = undefined;
    timedOut = false;
    // Opened now, in the click, or the browser takes it for a pop-up; sent to plex.tv once known.
    const tab = window.open('', '_blank');
    try {
      pin = await api.post<PlexPin>('/api/plex/auth');
      if (tab) {
        tab.location.href = pin.url;
      }
      const { id } = pin;
      const startedAt = Date.now();
      timer = setInterval(() => {
        if (Date.now() - startedAt > PLEX_GIVE_UP_MS) {
          stop();
          timedOut = true;
          return;
        }
        void check(id);
      }, PLEX_POLL_MS);
    } catch (error) {
      tab?.close();
      failure = error;
    } finally {
      busy = false;
    }
  }

  async function signOut(): Promise<void> {
    busy = true;
    failure = undefined;
    try {
      await api.delete('/api/plex/auth');
      account = null;
      servers = undefined;
    } catch (error) {
      failure = error;
    } finally {
      busy = false;
    }
  }

  const mine = $derived(ownedServers(servers ?? []));
  // The server whose address is in the field, if any: the field stays the truth, typed or picked.
  const current = $derived(
    mine.find((server) => addressesOf(server).some((address) => address.uri === url)),
  );
  const addresses = $derived(current ? addressesOf(current) : []);

  function pick(name: string): void {
    const server = mine.find((candidate) => candidate.name === name);
    // The best address is taken; the other menu is there for a container that cannot reach it.
    const best = server ? addressesOf(server)[0] : undefined;
    if (best) {
      url = best.uri;
    }
  }
</script>

<div class="field">
  <span class="label">{t('web.settings.plex.account')}</span>

  {#if pin}
    <p class="muted hint" role="status">{t('web.settings.plex.signin.waiting')}</p>
    <div class="buttons">
      <a class="btn" href={pin.url} target="_blank" rel="noopener noreferrer">
        {t('web.settings.plex.signin.reopen')}
      </a>
      <button type="button" class="btn" onclick={stop}>
        {t('web.settings.plex.signin.cancel')}
      </button>
    </div>
  {:else if account === 'signed-in' || account === 'expired'}
    <p class={account === 'expired' ? 'alert alert-danger' : 'muted hint'} role="status">
      {t(account === 'expired' ? 'web.settings.plex.expired' : 'web.settings.plex.signed-in')}
    </p>
    <div class="buttons">
      {#if account === 'expired'}
        <button type="button" class="btn btn-primary" disabled={busy} onclick={() => void signIn()}>
          {t('web.settings.plex.signin.again')}
        </button>
      {/if}
      <button type="button" class="btn" disabled={busy} onclick={() => void signOut()}>
        {t('web.settings.plex.signout')}
      </button>
    </div>

    {#if account === 'signed-in' && servers}
      {#if mine.length === 0}
        <p class="muted hint">{t('web.settings.plex.servers.empty')}</p>
      {:else}
        <label for="plex-server">{t('web.settings.plex.servers.label')}</label>
        <select
          id="plex-server"
          class="input"
          value={current?.name ?? ''}
          onchange={(event) => {
            pick(event.currentTarget.value);
          }}
        >
          <option value="">{t('web.settings.plex.servers.pick')}</option>
          {#each mine as server (server.name)}
            <option value={server.name}>{server.name}</option>
          {/each}
        </select>

        {#if addresses.length > 1}
          <label for="plex-address">{t('web.settings.plex.servers.other')}</label>
          <select
            id="plex-address"
            class="input mono"
            value={url}
            onchange={(event) => {
              url = event.currentTarget.value;
            }}
          >
            {#each addresses as address (address.uri)}
              <option value={address.uri}>
                {address.label} · {t(`web.settings.plex.servers.${address.kind}`)}
              </option>
            {/each}
          </select>
        {/if}
      {/if}
    {/if}
  {:else}
    <div class="buttons">
      <button type="button" class="btn btn-primary" disabled={busy} onclick={() => void signIn()}>
        {t('web.settings.plex.signin')}
      </button>
    </div>
    <span class="muted hint">{t('web.settings.plex.signin.hint')}</span>
  {/if}

  {#if timedOut}
    <p class="alert alert-danger" role="alert">{t('web.settings.plex.signin.timeout')}</p>
  {/if}
  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {/if}
</div>

<style>
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
