<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { onTopics } from '../lib/events.svelte.js';
  import { t } from '../lib/i18n.svelte.js';
  import { libraryApi } from '../lib/libraries.js';
  import type { TidyRequest, TidyTask } from '../lib/maintenance.js';
  import { resource } from '../lib/resource.svelte.js';
  import MaintenanceLibrary from './MaintenanceLibrary.svelte';

  // Only the libraries organized in place: an arrival folder is never tidied.
  const loaded = resource(() => libraryApi.list(), ['settings', 'ready']);
  const libraries = $derived((loaded.value ?? []).filter(({ type }) => type != null));

  // One task per library, in the server's memory: a page opened after the click (or in another tab)
  // finds the bar of a task still running, and the report of one that ended.
  const tasks = resource(
    () => api.get<{ tasks: TidyTask[] }>('/api/maintenance/tidy'),
    ['ready', 'history'],
  );
  const taskOf = (id: string): TidyTask | undefined =>
    tasks.value?.tasks.find(({ library }) => library === id);

  // Between a click and the first answer: the task may end, and announce it, before the answer comes back.
  let starting = $state(0);
  const watching = $derived(
    starting > 0 || (tasks.value?.tasks.some(({ status }) => status === 'running') ?? false),
  );

  // Only while a task goes on, so the scans' events do not make the page ask.
  const stopProgress = onTopics(['progress'], () => {
    if (watching) {
      void tasks.reload();
    }
  });
  onDestroy(stopProgress);

  async function start(request: TidyRequest): Promise<void> {
    starting++;
    try {
      await api.post<TidyTask>('/api/maintenance/tidy', request);
      await tasks.reload();
    } finally {
      starting--;
    }
  }
</script>

<div class="maintenance">
  <p class="alert alert-info intro">{t('web.maintenance.intro')}</p>

  {#if loaded.failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, loaded.failure)}</p>
  {/if}
  {#if tasks.failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, tasks.failure)}</p>
  {/if}

  {#if loaded.value === undefined && !loaded.failure}
    <p class="muted" role="status">{t('web.loading')}</p>
  {:else if libraries.length === 0}
    <p class="muted">{t('web.maintenance.none')}</p>
  {:else}
    {#each libraries as library (library.id)}
      <MaintenanceLibrary {library} task={taskOf(library.id)} onstart={start} />
    {/each}
  {/if}
</div>

<style>
  .maintenance {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  p {
    margin: 0;
  }

  .intro {
    max-width: 70ch;
  }
</style>
