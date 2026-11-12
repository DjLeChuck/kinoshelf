<script lang="ts">
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import { collectionApi, resultNotice, type CollectionDraft } from '../lib/collections.js';

  let {
    libraryId,
    items,
    onclose,
    ondone,
  }: {
    libraryId: string;
    /** The `id`s of the movies chosen. */
    items: readonly string[];
    onclose: () => void;
    ondone: (message: string) => void;
  } = $props();

  let name = $state('');
  let working = $state(false);
  let failure = $state<unknown>(undefined);

  async function apply(draft: CollectionDraft): Promise<void> {
    working = true;
    failure = undefined;
    try {
      ondone(resultNotice(await collectionApi.set(libraryId, items, draft), t));
    } catch (error) {
      failure = error;
    } finally {
      working = false;
    }
  }
</script>

<section class="card" aria-labelledby="bulk-collection">
  <h3 id="bulk-collection">{t('web.collection.bulk.title', { count: items.length })}</h3>
  <div class="row">
    <div class="field grow">
      <label for="bulk-collection-name">{t('web.collection.name')}</label>
      <input
        id="bulk-collection-name"
        class="input"
        bind:value={name}
        placeholder={t('web.collection.name.placeholder')}
      />
    </div>
    <button
      type="button"
      class="btn btn-primary"
      disabled={working || name.trim() === ''}
      onclick={() => void apply({ mode: 'custom', name })}
    >
      {t('web.collection.bulk.apply')}
    </button>
  </div>
  <div class="row">
    <button
      type="button"
      class="btn"
      disabled={working}
      onclick={() => void apply({ mode: 'tmdb', name: '' })}
    >
      {t('web.collection.bulk.tmdb')}
    </button>
    <button
      type="button"
      class="btn"
      disabled={working}
      onclick={() => void apply({ mode: 'none', name: '' })}
    >
      {t('web.collection.bulk.none')}
    </button>
    <button type="button" class="btn quiet" onclick={onclose}>
      {t('web.collection.bulk.cancel')}
    </button>
  </div>
  {#if failure}<p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>{/if}
  <p class="muted hint">{t('web.collection.bulk.hint')}</p>
</section>

<style>
  .card {
    border-color: var(--accent);
    gap: 12px;
  }

  h3 {
    font-size: 15px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 8px;
  }

  .grow {
    flex: 1 1 260px;
  }

  .quiet {
    border-color: transparent;
    color: var(--muted);
  }

  .hint {
    font-size: 12px;
  }
</style>
