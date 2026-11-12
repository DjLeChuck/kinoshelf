<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';

  // The line of ticks the three sheets share: present is a green tick, absent an orange cross with
  // the label in grey, and a screen reader hears "missing". `value` is `null` when the profile
  // writes none of it, `unavailable` when TMDB has none to give (a dash, neither present nor missing).
  export interface Mark {
    readonly label: string;
    readonly value: boolean | null;
    readonly unavailable?: boolean;
    /** What a screen reader hears besides the state, for a mark whose name is not enough. */
    readonly title?: string | undefined;
  }

  let { marks }: { marks: readonly Mark[] } = $props();

  const stateOf = (mark: Mark): string =>
    mark.unavailable
      ? t('web.library.unavailable')
      : mark.value === null
        ? '—'
        : t(mark.value ? 'web.library.present' : 'web.library.missing');
</script>

<span class="marks">
  {#each marks as mark (mark.label)}
    <span class="mark" class:absent={!mark.unavailable && mark.value === false} title={mark.title}>
      <span
        aria-hidden="true"
        class:ok={!mark.unavailable && mark.value === true}
        class:ko={!mark.unavailable && mark.value === false}
        >{mark.unavailable || mark.value === null ? '—' : mark.value ? '✓' : '✗'}</span
      >
      {mark.label}<span class="sr-only"
        >{mark.value === false && !mark.unavailable
          ? ` (${stateOf(mark)})`
          : `: ${stateOf(mark)}`}</span
      >
    </span>
  {/each}
</span>

<style>
  .marks {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
  }

  .ok {
    color: var(--ok);
  }

  .ko {
    color: var(--warn);
  }

  .absent {
    color: var(--muted);
  }
</style>
