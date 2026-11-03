<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../lib/i18n.svelte.js';
  import Link from './Link.svelte';

  // The head of a work's panel (a movie, a file, a show): artwork, title, a line of facts and the
  // link to TMDB. What follows it is the caller's.
  let {
    title,
    meta,
    tmdbUrl,
    poster,
    backdrop,
    children,
  }: {
    title: string;
    meta: string;
    tmdbUrl?: string | undefined;
    poster?: string | undefined;
    backdrop?: string | undefined;
    children: Snippet;
  } = $props();
</script>

<article class="card">
  {#if backdrop}<img class="backdrop" src={backdrop} alt="" loading="lazy" />{/if}
  <div class="head">
    {#if poster}<img class="poster" src={poster} alt="" width="92" height="138" />{/if}
    <div>
      <h2>{title}</h2>
      <p class="muted">{meta}</p>
      {#if tmdbUrl}
        <Link href={tmdbUrl} target="_blank" rel="noreferrer">{t('web.queue.tmdb-link')}</Link>
      {/if}
    </div>
  </div>
  {@render children()}
</article>

<style>
  .backdrop {
    display: block;
    width: 100%;
    max-height: 180px;
    object-fit: cover;
    border-radius: var(--radius-sm);
  }

  .head {
    display: flex;
    gap: 16px;
  }

  .poster {
    flex: none;
    border-radius: 4px;
  }

  h2 {
    font-size: 18px;
  }

  p {
    margin: 0;
  }
</style>
