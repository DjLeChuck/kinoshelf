<script lang="ts">
  import type { NfoTally } from '../lib/library-items.js';
  import Presence from './Presence.svelte';

  // The NFO of one or several files: a mark when one is expected or all are there, else how many.
  // A season always says how many (`7/8`), green when all are there.
  let { tally, always = false }: { tally: NfoTally; always?: boolean } = $props();

  const complete = $derived(tally.present === tally.expected);
</script>

{#if tally.expected > 0}
  {#if always}
    <span class="chip {complete ? 'chip-ok' : 'chip-warn'}">{tally.present}/{tally.expected}</span>
  {:else if tally.expected === 1 || complete}
    <Presence value={complete} />
  {:else}
    <span class="chip chip-warn">{tally.present}/{tally.expected}</span>
  {/if}
{/if}
