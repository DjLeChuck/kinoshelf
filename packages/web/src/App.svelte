<script lang="ts">
  import ComingSoon from './components/ComingSoon.svelte';
  import Shell from './components/Shell.svelte';
  import { messageOf } from './lib/errors.js';
  import { connectEvents, disconnectEvents } from './lib/events.svelte.js';
  import { t } from './lib/i18n.svelte.js';
  import { router } from './lib/router.svelte.js';
  import { idOf } from './lib/routes.js';
  import { session } from './lib/session.svelte.js';
  import Home from './pages/Home.svelte';
  import History from './pages/History.svelte';
  import Job from './pages/Job.svelte';
  import Login from './pages/Login.svelte';
  import NotFound from './pages/NotFound.svelte';
  import Queue from './pages/Queue.svelte';
  import Settings from './pages/Settings.svelte';

  let failure = $state<unknown>(undefined);
  const jobId = $derived(idOf('jobs', router.path));

  async function check(): Promise<void> {
    failure = undefined;
    try {
      await session.check();
    } catch (error) {
      failure = error;
    }
  }

  void check();

  // The stream only exists while signed in: the API refuses it otherwise.
  $effect(() => {
    if (session.status === 'signed-in') {
      connectEvents();
      return disconnectEvents;
    }
    return undefined;
  });
</script>

{#if session.status === 'signed-out'}
  <Login />
{:else if session.status === 'signed-in'}
  <div class="app">
    <Shell>
      {#if jobId}
        {#key jobId}<Job id={jobId} />{/key}
      {:else if router.route?.id === 'home'}
        <Home />
      {:else if router.route?.id === 'queue'}
        <Queue />
      {:else if router.route?.id === 'history'}
        <History />
      {:else if router.route?.id === 'settings'}
        <Settings />
      {:else if router.route?.id === 'media'}
        <ComingSoon kinds={['media']} />
      {:else if router.route?.id === 'libraries'}
        <ComingSoon kinds={['libraries', 'scan']} />
      {:else}
        <NotFound />
      {/if}
    </Shell>
  </div>
{:else if failure}
  <main class="center">
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
    <button type="button" class="btn" onclick={() => void check()}>{t('web.retry')}</button>
  </main>
{:else}
  <main class="center"><p class="muted" role="status">{t('web.loading')}</p></main>
{/if}

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .center {
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 16px;
    min-height: 100vh;
    padding: 16px;
  }
</style>
