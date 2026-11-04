<script lang="ts">
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import { libraryApi } from '../lib/libraries.js';

  let {
    libraryId,
    path,
    name,
    ondone,
  }: {
    libraryId: string;
    /** The folder to read again; none (or not yet known) leaves the button off. */
    path: string | undefined;
    /** What the notice calls the work. */
    name: string;
    /** The analysis was queued: what to tell the user. */
    ondone: (message: string) => void;
  } = $props();

  let starting = $state(false);
  let failure = $state<unknown>(undefined);

  async function start(): Promise<void> {
    if (path === undefined) {
      return;
    }
    starting = true;
    failure = undefined;
    try {
      await libraryApi.rescan(libraryId, path);
      ondone(t('web.library.rescan.started', { name }));
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
    disabled={starting}
    title={t('web.library.rescan.hint')}
    onclick={() => void start()}>{t('web.library.rescan')}</button
  >
  {#if failure !== undefined}
    <span class="alert alert-danger" role="alert">{messageOf(t, failure)}</span>
  {/if}
{/if}
