<script lang="ts">
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { t } from '../lib/i18n.svelte.js';

  interface WatchStatus {
    readonly enabled: boolean;
    readonly mode: 'events' | 'poll';
    readonly folders: readonly { readonly path: string; readonly available: boolean }[];
    readonly pending: number;
  }

  let { onresult }: { onresult: (message: string) => void } = $props();

  let status = $state<WatchStatus | undefined>(undefined);
  let busy = $state(false);
  let failure = $state<unknown>(undefined);

  async function load(): Promise<void> {
    try {
      status = await api.get<WatchStatus>('/api/watch');
    } catch {
      // The status is a convenience: the queue works without it.
      status = undefined;
    }
  }
  refetchOn(['settings', 'jobs'], () => void load());

  async function run(task: () => Promise<string>): Promise<void> {
    busy = true;
    failure = undefined;
    try {
      onresult(await task());
      await load();
    } catch (error) {
      failure = error;
    } finally {
      busy = false;
    }
  }

  const scan = (): Promise<void> =>
    run(async () => {
      const { submitted, pending } = await api.post<{ submitted: number; pending: number }>(
        '/api/watch/scan',
      );
      return t('web.queue.sources.scanned', { submitted, pending });
    });
</script>

<section class="card" aria-label={t('web.queue.sources.title')}>
  {#if status?.enabled}
    <p>
      {t(
        status.mode === 'poll' ? 'web.queue.sources.watching.poll' : 'web.queue.sources.watching',
        {
          count: status.folders.length,
        },
      )}
      {#if status.pending > 0}
        <span class="muted">{t('web.queue.sources.pending', { count: status.pending })}</span>
      {/if}
    </p>
    <ul class="folders mono">
      {#each status.folders as folder (folder.path)}
        <li>
          {folder.path}
          {#if !folder.available}
            <span class="chip chip-danger">{t('web.queue.sources.unavailable')}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">{t('web.queue.sources.none')}</p>
  {/if}

  <div class="scan">
    <button
      type="button"
      class="btn"
      disabled={busy || !status?.enabled}
      onclick={() => void scan()}
    >
      {t('web.queue.sources.scan')}
    </button>
    <span class="muted hint">{t('web.queue.sources.scan.hint')}</span>
  </div>

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {/if}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  p {
    margin: 0;
  }

  .folders {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
  }

  .scan {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
  }

  .hint {
    font-size: 12px;
  }
</style>
