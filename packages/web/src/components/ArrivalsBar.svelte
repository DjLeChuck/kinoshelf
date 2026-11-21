<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import Tip from './Tip.svelte';

  let {
    checked,
    indeterminate,
    ontoggle,
    count,
    selected,
    canTransfer,
    busy,
    onignore,
    ontransfer,
  }: {
    /** Every release on the page is ticked. */
    checked: boolean;
    indeterminate: boolean;
    /** The "select all" box was changed (the releases the page holds). */
    ontoggle: (checked: boolean) => void;
    /** What is ticked: the actions show once there is something. */
    count: number;
    /** The words for that count ("3 releases selected"). */
    selected: string;
    /** Every ticked release is ready to transfer: only then can they go together. */
    canTransfer: boolean;
    /** An action is running. */
    busy: boolean;
    onignore: () => void;
    ontransfer: () => void;
  } = $props();
</script>

<div class="bar" role="group" aria-label={t('web.arrivals.bar.label')}>
  <label class="check">
    <input
      type="checkbox"
      {checked}
      {indeterminate}
      onchange={(event) => {
        ontoggle(event.currentTarget.checked);
      }}
    />
    {t('web.arrivals.select-all')}
  </label>
  {#if count > 0}
    <span role="status">{selected}</span>
    <Tip text={t('web.tip.ignore')}>
      {#snippet children(describedby)}
        <button
          type="button"
          class="btn"
          disabled={busy}
          aria-describedby={describedby}
          onclick={onignore}
        >
          {t('web.arrivals.bar.ignore')}
        </button>
      {/snippet}
    </Tip>
    <Tip text={canTransfer ? undefined : t('web.arrivals.bar.transfer.hint')}>
      {#snippet children(describedby)}
        <button
          type="button"
          class="btn btn-primary"
          disabled={busy || !canTransfer}
          aria-describedby={describedby}
          onclick={ontransfer}
        >
          {t('web.arrivals.bar.transfer')}
        </button>
      {/snippet}
    </Tip>
  {/if}
</div>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  /* The count of what is ticked, set apart from the "select all" box before it. */
  .bar > span {
    margin-left: 4px;
    padding-left: 12px;
    border-left: 1px solid var(--border-strong);
  }
</style>
