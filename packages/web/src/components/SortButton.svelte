<script lang="ts">
  import type { SortColumn, SortState } from '../lib/list-filters.js';

  // The button of a sortable column's header. The `<th>` (and its `aria-sort`) stays in the table,
  // whose styles keep the header in view: a cell drawn here would not get them.
  let {
    column,
    current,
    label,
    onsort,
  }: {
    column: SortColumn;
    current: SortState;
    label: string;
    onsort: (column: SortColumn) => void;
  } = $props();

  const sorted = $derived(current.sort === column);
</script>

<button
  type="button"
  class="sort"
  class:on={sorted}
  onclick={() => {
    onsort(column);
  }}
>
  {label}
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style:transform={sorted && current.dir === 'asc' ? 'rotate(180deg)' : undefined}
    ><path d="M6 9l6 6 6-6" /></svg
  >
</button>

<style>
  .sort {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
  }

  .sort.on {
    color: var(--text);
  }

  svg {
    opacity: 0.35;
    transition: transform 0.15s;
  }

  .on svg {
    opacity: 1;
  }
</style>
