<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import type { ShowFilter } from '../lib/library-items.js';
  import {
    nothingToHandle,
    pillLabel,
    type Chip,
    type ListFilters,
    type Pill,
  } from '../lib/list-filters.js';

  let {
    chips,
    filters,
    pills,
    collectionName,
    result,
    onstate,
    onremove,
    onreset,
  }: {
    chips: readonly Chip[];
    filters: ListFilters;
    pills: readonly Pill[];
    /** The name to show on the pill of one collection. */
    collectionName: string;
    /** "2 movies of 5" while the list is narrowed, else empty. */
    result: string;
    onstate: (next: ShowFilter | undefined) => void;
    onremove: (pill: Pill) => void;
    onreset: () => void;
  } = $props();
</script>

<div class="row">
  <div class="group" role="group" aria-label={t('web.library.todo.label')}>
    {#each chips as chip (chip.state ?? 'all')}
      <button
        type="button"
        class="btn chip-btn"
        aria-pressed={filters.state === chip.state}
        onclick={() => {
          onstate(chip.state);
        }}
      >
        {t(`web.library.filter.${chip.state ?? 'all'}`)}
        <span class="count" class:todo={chip.state !== undefined}>{chip.count}</span>
      </button>
    {/each}
    {#if nothingToHandle(chips, filters.state)}
      <span class="clean">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg
        >
        {t('web.library.nothing')}
      </span>
    {/if}
  </div>

  {#if pills.length > 0}
    <span class="divider" aria-hidden="true"></span>
    <div class="group" role="group" aria-label={t('web.library.filters.active')}>
      {#each pills as pill (pill.id)}
        {@const label = pillLabel(pill, t, collectionName)}
        <button
          type="button"
          class="btn pill"
          aria-label={t('web.library.filters.remove', { name: label })}
          onclick={() => {
            onremove(pill);
          }}
        >
          {label}
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
      {/each}
      <button type="button" class="btn clear" onclick={onreset}>
        {t('web.library.filters.clear')}
      </button>
    </div>
  {/if}

  <!-- Always there, so a screen reader hears the count change when it is filled. -->
  <span class="result muted" role="status">{result}</span>
</div>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .chip-btn[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--surface-2);
  }

  .count {
    color: var(--muted);
    font-weight: 600;
  }

  .count.todo {
    color: var(--warn);
  }

  .clean {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px;
    color: var(--muted);
    font-size: 13px;
  }

  .clean svg {
    color: var(--ok);
  }

  .divider {
    width: 1px;
    height: 24px;
    margin: 0 4px;
    background: var(--border-strong);
  }

  .pill {
    border-color: var(--accent);
    border-radius: 999px;
    background: var(--warn-bg);
    padding: 0 14px;
  }

  .clear {
    border-color: transparent;
    padding: 0 10px;
    color: var(--muted);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .result {
    margin-left: auto;
    font-size: 13px;
  }
</style>
