<script lang="ts">
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import { libraryApi } from '../lib/libraries.js';

  let {
    libraryId,
    path,
    name,
    compact = false,
    ondone,
  }: {
    libraryId: string;
    /** The folder to read again; none (or not yet known) leaves the button off. */
    path: string | undefined;
    /** What the notice calls the work. */
    name: string;
    /** A line of a list rather than a panel: a small button, set apart from what precedes it. */
    compact?: boolean;
    /** The analysis was queued: what to tell the user. */
    ondone: (message: string) => void;
  } = $props();

  let starting = $state(false);
  let failure = $state<unknown>(undefined);

  async function start(): Promise<void> {
    if (path === undefined) {
      return;
    }
    // Read now: the panel may show another work by the time the answer comes.
    const label = name;
    starting = true;
    failure = undefined;
    try {
      await libraryApi.rescan(libraryId, path);
      ondone(t('web.library.rescan.started', { name: label }));
    } catch (error) {
      failure = error;
    } finally {
      starting = false;
    }
  }
</script>

{#if path !== undefined}
  <button
    type="button"
    class="btn"
    class:compact
    disabled={starting}
    title={t('web.library.rescan.hint')}
    onclick={() => void start()}>{t('web.library.rescan')}</button
  >
  {#if failure !== undefined}
    <span class="alert alert-danger" role="alert">{messageOf(t, failure)}</span>
  {/if}
{/if}

<style>
  .compact {
    min-height: 28px;
    padding: 0 10px;
    margin-inline: 12px 8px;
    border-radius: 8px;
    font-size: 13px;
  }
</style>
