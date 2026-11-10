<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { PAGE_SIZE, type ChangeRow, type RowGroup } from '../lib/change-list.js';

  let {
    group,
    detail,
  }: {
    group: RowGroup;
    detail?: Snippet<[ChangeRow]> | undefined;
  } = $props();

  // One row alone is not worth a fold: a movie reads as a line, a show as a line that opens.
  const single = $derived(group.rows.length === 1 ? group.rows[0] : undefined);
  // The rows are only drawn once the group is open: a library of thousands stays light.
  // svelte-ignore state_referenced_locally
  let open = $state(group.problems > 0);
  let limit = $state(PAGE_SIZE);
  const visible = $derived(group.rows.slice(0, limit));
</script>

{#snippet chips(row: ChangeRow)}
  {#each row.chips as chip (chip.text)}
    <span class="chip chip-{chip.tone}" title={row.note}>{chip.text}</span>
  {/each}
{/snippet}

{#snippet line(row: ChangeRow)}
  <div class="line">
    {#if row.tag}<span class="tag mono">{row.tag}</span>{/if}
    {#if row.title}<span class="title">{row.title}</span>{/if}
    {#if row.before !== undefined && row.after !== undefined}
      <span class="rename mono">
        <span class="from" title={row.beforeTitle}>{row.before}</span>
        <span aria-hidden="true">→</span>
        <span class="to" title={row.afterTitle}>{row.after}</span>
      </span>
    {:else if row.after !== undefined}
      <span class="rename mono" title={row.afterTitle}>{row.after}</span>
    {:else if row.before !== undefined}
      <span class="rename mono" title={row.beforeTitle}>{row.before}</span>
    {/if}
    {@render chips(row)}
  </div>
  {#if row.note}<p class="note">{row.note}</p>{/if}
  {#if detail && row.detailCount > 0}
    <details class="more" open={row.problem}>
      <summary>{t('web.changes.companions', { count: row.detailCount })}</summary>
      <div class="detail">{@render detail(row)}</div>
    </details>
  {/if}
{/snippet}

{#if single}
  <div class="row single">{@render line(single)}</div>
{:else}
  <details bind:open class="group">
    <summary>
      <span class="label">{group.label}</span>
      {#if group.problems > 0}
        <span class="chip chip-danger">{t('web.changes.problems', { count: group.problems })}</span>
      {/if}
      <span class="muted count">{t('web.library.run.files', { count: group.rows.length })}</span>
    </summary>
    {#if open}
      <div class="rows">
        {#each visible as row (row.id)}
          <div class="row">{@render line(row)}</div>
        {/each}
        {#if group.rows.length > visible.length}
          <button
            type="button"
            class="btn more-rows"
            onclick={() => {
              limit += PAGE_SIZE;
            }}
          >
            {t('web.changes.more', {
              count: Math.min(PAGE_SIZE, group.rows.length - visible.length),
            })}
            <span class="muted">{group.rows.length - visible.length}</span>
          </button>
        {/if}
      </div>
    {/if}
  </details>
{/if}

<style>
  .group > summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 12px;
    padding: 8px 0;
    cursor: pointer;
  }

  .label {
    flex: 1 1 0;
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .count {
    font-size: 12px;
  }

  .rows {
    margin: 0 0 8px 10px;
    padding-left: 12px;
    border-left: 2px solid var(--border);
  }

  .row {
    padding: 4px 0;
  }

  .single {
    padding: 8px 0;
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
    min-width: 0;
  }

  .tag {
    flex: none;
    color: var(--muted);
    font-size: 12px;
  }

  .title {
    font-weight: 600;
  }

  .rename {
    flex: 1 1 0;
    min-width: 0;
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .from {
    color: var(--muted);
  }

  .note {
    margin: 2px 0 0;
    color: var(--danger, inherit);
    font-size: 12px;
  }

  .more {
    margin-top: 2px;
  }

  .more > summary {
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
  }

  .detail {
    margin-top: 4px;
  }

  .more-rows {
    margin-top: 6px;
  }
</style>
