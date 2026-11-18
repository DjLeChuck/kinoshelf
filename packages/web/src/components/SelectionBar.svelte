<script lang="ts">
  import type { MessageKey } from '@kinoshelf/i18n';
  import type { Snippet } from 'svelte';
  import { t } from '../lib/i18n.svelte.js';
  import type { BulkAction } from '../lib/library-items.js';
  import Tip from './Tip.svelte';

  let {
    checked,
    indeterminate,
    ontoggle,
    everything,
    count,
    selected,
    disabled,
    onrun,
    extra,
  }: {
    /** Everything that can be ticked is. */
    checked: boolean;
    indeterminate: boolean;
    /** The "select all" box was changed. */
    ontoggle: (checked: boolean) => void;
    /** The button that ticks what the page does not show; left out when the list fits one page. */
    everything: { label: string; onclick: () => void } | undefined;
    /** What is ticked: the actions show once there is something. */
    count: number;
    /** The words for that count ("3 movies selected"). */
    selected: string;
    /** Which action has nothing to do on the selection (or is already running). */
    disabled: Record<BulkAction, boolean>;
    onrun: (action: BulkAction) => void;
    /** What only one of the lists offers, after the common actions. */
    extra?: Snippet;
  } = $props();

  const ACTIONS: { action: BulkAction; label: MessageKey; tip: MessageKey; primary?: boolean }[] = [
    { action: 'rename', label: 'web.library.run.rename', tip: 'web.tip.organize', primary: true },
    { action: 'refresh', label: 'web.library.run.refresh', tip: 'web.tip.complete' },
    { action: 'version', label: 'web.library.run.version', tip: 'web.tip.version' },
  ];
</script>

<div class="bar" role="group">
  <label class="check">
    <input
      type="checkbox"
      {checked}
      {indeterminate}
      onchange={(event) => {
        ontoggle(event.currentTarget.checked);
      }}
    />
    {t('web.library.run.all')}
  </label>
  {#if everything}
    <button type="button" class="btn" onclick={everything.onclick}>{everything.label}</button>
  {/if}
  {#if count > 0}
    <span>{selected}</span>
    {#each ACTIONS as { action, label, tip, primary } (action)}
      <Tip text={t(tip)}>
        {#snippet children(describedby)}
          <button
            type="button"
            class={primary ? 'btn btn-primary' : 'btn'}
            disabled={disabled[action]}
            aria-describedby={describedby}
            onclick={() => {
              onrun(action);
            }}
          >
            {t(label)}
          </button>
        {/snippet}
      </Tip>
    {/each}
    {@render extra?.()}
  {/if}
</div>

<style>
  .bar {
    display: flex;
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
