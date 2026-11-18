<script lang="ts">
  import { locale, t } from '../lib/i18n.svelte.js';
  import { ratingLines } from '../lib/fiche.js';
  import Tip from './Tip.svelte';

  let {
    ratings,
  }: {
    ratings: {
      readonly tmdb: { readonly value: number; readonly votes: number } | null;
      readonly imdb: { readonly value: number; readonly votes: number } | null;
    };
  } = $props();

  const lines = $derived(ratingLines(ratings, locale.value, t));
</script>

<!-- The value shows; how many votes stand behind it opens on hover or focus. -->
{#if lines.length > 0}
  <dt class="muted">{t('web.library.ratings')}</dt>
  <dd>
    {#each lines as line, index (line.source)}
      {#if index > 0}<span class="muted"> · </span>{/if}
      <Tip text={line.votes}>
        {#snippet children(describedby)}
          <span class="rating" aria-describedby={describedby}>{line.source} {line.value}</span>
        {/snippet}
      </Tip>
    {/each}
  </dd>
{/if}

<style>
  .rating {
    cursor: help;
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }
</style>
