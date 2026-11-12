<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import {
    COLLECTION_FILTERS,
    ITEM_SORTS,
    type CollectionFilter,
    type ItemSort,
  } from '../lib/collections.js';

  let {
    counts,
    filter,
    sort,
    activeName,
    onfilter,
    onsort,
  }: {
    counts: Readonly<Record<'all' | 'in' | 'out' | 'incomplete', number>>;
    /** `in`, `out`, `incomplete`, the key of one collection, or none. */
    filter: CollectionFilter | undefined;
    sort: ItemSort;
    /** The name to show on the chip when the filter is one collection. */
    activeName: string;
    onfilter: (next: CollectionFilter | undefined) => void;
    onsort: (next: ItemSort) => void;
  } = $props();

  const single = $derived(
    filter !== undefined && !(COLLECTION_FILTERS as readonly string[]).includes(filter),
  );
</script>

<div class="collections">
  <div class="line">
    <span id="coll-filter" class="label">{t('web.collection.filter.label')}</span>
    <div class="pills" role="group" aria-labelledby="coll-filter">
      {#each [undefined, ...COLLECTION_FILTERS] as option (option ?? 'all')}
        <button
          type="button"
          class="btn"
          aria-pressed={filter === option}
          onclick={() => {
            onfilter(option);
          }}
        >
          {t(`web.collection.filter.${option ?? 'all'}`)}
          <span class="count">{counts[option ?? 'all']}</span>
        </button>
      {/each}
      {#if single}
        <button
          type="button"
          class="btn active"
          aria-label={t('web.collection.filter.remove', { name: activeName })}
          onclick={() => {
            onfilter(undefined);
          }}
        >
          {t('web.collection.filter.active', { name: activeName })}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg
          >
        </button>
      {/if}
    </div>
  </div>

  <fieldset class="line sort">
    <legend class="label">{t('web.collection.sort.label')}</legend>
    <div class="segments">
      {#each ITEM_SORTS as option (option)}
        <label class:on={sort === option}>
          <input
            class="sr-only"
            type="radio"
            name="collection-sort"
            value={option}
            checked={sort === option}
            onchange={() => {
              onsort(option);
            }}
          />
          {t(`web.collection.sort.${option}`)}
        </label>
      {/each}
    </div>
  </fieldset>
  <p class="muted hint">{t('web.collection.sort.hint')}</p>
</div>

<style>
  .collections {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
  }

  .label {
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
  }

  .pills {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .pills [aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--surface-2);
  }

  .count {
    color: var(--muted);
  }

  .active {
    border-color: var(--accent);
    border-radius: 999px;
    background: var(--warn-bg);
  }

  fieldset {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    float: left;
    margin-right: 16px;
    padding: 0;
    line-height: 44px;
  }

  .segments {
    display: flex;
    gap: 4px;
    padding: 4px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--surface);
  }

  .segments label {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 88px;
    min-height: 36px;
    padding: 0 14px;
    border-radius: 7px;
    color: var(--muted);
    font-weight: 600;
    cursor: pointer;
  }

  .segments label.on {
    background: var(--surface-2);
    color: var(--text);
  }

  .segments label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .hint {
    font-size: 12px;
  }
</style>
