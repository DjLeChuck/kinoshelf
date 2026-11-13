<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../lib/i18n.svelte.js';
  import {
    PAGE_SIZE,
    countGroups,
    groupRows,
    type ChangeRow,
    type Scope,
  } from '../lib/change-list.js';
  import ChangeGroup from './ChangeGroup.svelte';

  let {
    rows,
    detail,
    lead,
  }: {
    rows: readonly ChangeRow[];
    /** What a row hides behind "+N files". */
    detail?: Snippet<[ChangeRow]>;
    /** Shown at the left of the bar, on the search's line. */
    lead?: Snippet;
  } = $props();

  const counts = $derived(countGroups(rows));
  // Starts on the problems, when there are any: they are what the list is read for. A choice made
  // since is kept, whatever the rows do (a batch refreshes as it runs).
  let chosen = $state<Scope | undefined>(undefined);
  const scope = $derived<Scope>(chosen ?? (counts.problems > 0 ? 'problems' : 'all'));
  let query = $state('');
  let limit = $state(PAGE_SIZE);

  const groups = $derived(groupRows(rows, scope, query));
  const shown = $derived(groups.slice(0, limit));
  const clean = $derived(counts.all - counts.problems);

  function choose(next: Scope): void {
    chosen = next;
    limit = PAGE_SIZE;
  }
</script>

<div class="change-list">
  <div class="bar">
    {#if lead}
      <div class="lead">{@render lead()}</div>
    {/if}
    {#if counts.problems > 0}
      <div class="scopes" role="group" aria-label={t('web.changes.scope.label')}>
        {#each ['problems', 'all'] as const as option (option)}
          <button
            type="button"
            class="btn"
            aria-pressed={scope === option}
            onclick={() => {
              choose(option);
            }}
          >
            {t(`web.changes.scope.${option}`)}
            <span class="count">{option === 'problems' ? counts.problems : counts.all}</span>
          </button>
        {/each}
      </div>
    {/if}
    <input
      type="search"
      class="input search"
      placeholder={t('web.changes.search')}
      aria-label={t('web.changes.search')}
      bind:value={query}
      oninput={() => {
        limit = PAGE_SIZE;
      }}
    />
  </div>

  {#if shown.length === 0}
    <p class="muted" role="status">{t('web.changes.none')}</p>
  {:else}
    <ul class="groups">
      {#each shown as group (group.key)}
        <li>
          <ChangeGroup {group} {detail} />
        </li>
      {/each}
    </ul>
  {/if}

  {#if groups.length > shown.length}
    <button
      type="button"
      class="btn more"
      onclick={() => {
        limit += PAGE_SIZE;
      }}
    >
      {t('web.changes.more', { count: Math.min(PAGE_SIZE, groups.length - shown.length) })}
      <span class="count">{groups.length - shown.length}</span>
    </button>
  {/if}

  {#if scope === 'problems' && clean > 0 && query === ''}
    <p class="muted clean">
      {t('web.changes.clean', { count: clean })}
      <button
        type="button"
        class="link"
        onclick={() => {
          choose('all');
        }}>{t('web.changes.show-all')}</button
      >
    </p>
  {/if}
</div>

<style>
  .change-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
  }

  .lead {
    flex: 1 1 200px;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .scopes {
    display: flex;
    gap: 6px;
  }

  .scopes [aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--surface-2);
  }

  .count {
    margin-left: 6px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .search {
    flex: 1 1 200px;
    min-width: 0;
    max-width: 320px;
    margin-left: auto;
  }

  .groups {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .groups li {
    border-top: 1px solid var(--border);
  }

  .groups li:first-child {
    border-top: 0;
  }

  .more {
    align-self: flex-start;
  }

  .clean {
    margin: 0;
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
  }
</style>
