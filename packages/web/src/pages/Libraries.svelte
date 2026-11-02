<script lang="ts">
  import { messageOf } from '../lib/errors.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { t } from '../lib/i18n.svelte.js';
  import { libraryApi, type Library } from '../lib/libraries.js';
  import { router } from '../lib/router.svelte.js';
  import { shell } from '../lib/shell-state.svelte.js';
  import ArrivalsView from '../components/ArrivalsView.svelte';
  import Link from '../components/Link.svelte';
  import LibraryView from '../components/LibraryView.svelte';
  import NotFound from './NotFound.svelte';

  let libraries = $state<readonly Library[] | undefined>(undefined);
  let failure = $state<unknown>(undefined);

  async function load(): Promise<void> {
    try {
      libraries = await libraryApi.list();
      failure = undefined;
    } catch (error) {
      failure = error;
    }
  }

  refetchOn(['settings', 'jobs', 'ready'], () => void load());

  const typed = $derived(libraries?.filter((library) => library.type != null) ?? []);
  const hasArrivals = $derived(libraries?.some((library) => library.into != null) ?? false);
  const arrivalsTab = $derived(router.path.replace(/\/+$/, '') === '/arrivals');
  const libraryId = $derived(/^\/libraries\/([^/]+)\/?$/.exec(router.path)?.[1]);
  const current = $derived(typed.find(({ id }) => id === libraryId));

  // `/libraries` alone opens what most needs a look: the arrivals, else the first library.
  $effect(() => {
    if (libraries === undefined || router.path.replace(/\/+$/, '') !== '/libraries') {
      return;
    }
    if (hasArrivals && (shell.arrivals ?? 0) > 0) {
      router.navigate('/arrivals', { replace: true });
    } else if (typed[0]) {
      router.navigate(`/libraries/${typed[0].id}`, { replace: true });
    } else if (hasArrivals) {
      router.navigate('/arrivals', { replace: true });
    }
  });
</script>

<div class="page">
  <h1>{t('web.libraries.title')}</h1>

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
    <button type="button" class="btn" onclick={() => void load()}>{t('web.retry')}</button>
  {:else if libraries === undefined}
    <p class="muted" role="status">{t('web.loading')}</p>
  {:else if typed.length === 0 && !hasArrivals}
    <section class="card">
      <p class="muted">{t('web.library.none')}</p>
      <Link href="/settings#libraries" class="btn">{t('web.library.none.link')}</Link>
    </section>
  {:else}
    <nav class="tabs" aria-label={t('web.library.tabs')}>
      {#if hasArrivals}
        <Link href="/arrivals" class="tab" aria-current={arrivalsTab ? 'page' : undefined}>
          {t('web.arrivals.title')}
          {#if (shell.arrivals ?? 0) > 0}<span class="chip chip-warn">{shell.arrivals}</span>{/if}
        </Link>
      {/if}
      {#each typed as library (library.id)}
        <Link
          href={`/libraries/${library.id}`}
          class="tab"
          aria-current={libraryId === library.id ? 'page' : undefined}
        >
          {library.name}
        </Link>
      {/each}
    </nav>

    {#if arrivalsTab && hasArrivals}
      <ArrivalsView />
    {:else if current}
      {#key current.id}<LibraryView library={current} />{/key}
    {:else if router.path.replace(/\/+$/, '') !== '/libraries'}
      <NotFound />
    {/if}
  {/if}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  h1 {
    font-size: 22px;
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    border-bottom: 1px solid var(--border);
  }

  .tabs :global(.tab) {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 14px;
    border-bottom: 2px solid transparent;
    color: var(--muted);
    text-decoration: none;
  }

  .tabs :global(.tab[aria-current='page']) {
    border-bottom-color: var(--accent);
    color: var(--text);
    font-weight: 600;
  }
</style>
