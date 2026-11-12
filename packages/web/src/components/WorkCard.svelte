<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../lib/i18n.svelte.js';
  import type { ImageKind } from '../lib/arrivals.js';
  import Link from './Link.svelte';

  // The head of a work's panel (a movie, a file, a show): artwork, title, a line of facts and the
  // link to TMDB. What follows it is the caller's. With `onedit`, the three images are buttons that
  // open the image dialog on their tab: the logo sits on the background as a player draws it, and
  // has a zone of its own so that pointing at it never targets the background.
  let {
    title,
    kicker,
    meta,
    tmdbUrl,
    poster,
    backdrop,
    logo,
    onedit,
    still,
    children,
  }: {
    title: string;
    /** A line above the title: an episode names its series and number there. */
    kicker?: string | undefined;
    meta: string;
    tmdbUrl?: string | undefined;
    poster?: string | undefined;
    backdrop?: string | undefined;
    logo?: string | undefined;
    /** Absent when the images cannot be changed: they are then only shown. */
    onedit?: ((type: ImageKind) => void) | undefined;
    /** The banner's place taken by the caller's own (an episode's 16:9 thumbnail). */
    still?: Snippet | undefined;
    children: Snippet;
  } = $props();
</script>

<article class="card">
  {#if still}
    <div class="stage">{@render still()}</div>
  {:else if backdrop || onedit}
    <div class="stage">
      {#if onedit}
        <button
          type="button"
          class="zone fanart"
          aria-label={t('web.images.change-fanart')}
          onclick={() => {
            onedit('fanart');
          }}
        >
          {#if backdrop}<img src={backdrop} alt="" loading="lazy" />{/if}
          <span class="veil" aria-hidden="true"></span>
          <span class="pill" aria-hidden="true">{t('web.images.change-fanart')}</span>
        </button>
      {:else if backdrop}
        <img class="plain" src={backdrop} alt="" loading="lazy" />
      {/if}
      {#if backdrop || logo}
        <span class="shade" aria-hidden="true"></span>
      {/if}
      {#if onedit}
        {#if logo}
          <button
            type="button"
            class="zone logo"
            aria-label={t('web.images.change-logo')}
            onclick={() => {
              onedit('logo');
            }}
          >
            <img src={logo} alt="" />
            <span class="tag" aria-hidden="true">{t('web.images.change-logo')}</span>
          </button>
        {:else}
          <button
            type="button"
            class="zone logo add"
            onclick={() => {
              onedit('logo');
            }}
          >
            + {t('web.images.add-logo')}
          </button>
        {/if}
      {:else if logo}
        <img class="logo plain-logo" src={logo} alt="" />
      {/if}
    </div>
  {/if}
  <div class="head">
    {#if onedit}
      <button
        type="button"
        class="zone poster-button"
        aria-label={t('web.images.change-poster')}
        onclick={() => {
          onedit('poster');
        }}
      >
        {#if poster}<img class="poster" src={poster} alt="" width="92" height="138" />{/if}
        <span class="veil" aria-hidden="true">{t('web.images.change-poster')}</span>
      </button>
    {:else if poster}
      <img class="poster" src={poster} alt="" width="92" height="138" />
    {/if}
    <div>
      {#if kicker}<p class="kicker muted">{kicker}</p>{/if}
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
  .stage {
    position: relative;
    height: 180px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-2, rgb(128 128 128 / 0.15));
  }

  .stage img.plain,
  .fanart img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* A dark corner under the logo, so a white title reads on any background. */
  .shade {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(to top right, rgb(10 12 16 / 0.7), rgb(10 12 16 / 0) 65%);
  }

  .zone {
    position: relative;
    padding: 0;
    border: 0;
    background: none;
    color: #fff;
    cursor: pointer;
  }

  .fanart {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: 0;
  }

  /* Pointing and focusing look the same, so the keyboard sees what the mouse does. */
  .veil {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(10 12 16 / 0.6);
    font-weight: 600;
    font-size: 13px;
    opacity: 0;
  }

  .fanart .veil {
    background: rgb(10 12 16 / 0.35);
  }

  .pill {
    position: absolute;
    top: 10px;
    right: 10px;
    min-height: 44px;
    display: flex;
    align-items: center;
    padding: 0 14px;
    border-radius: 22px;
    background: rgb(20 22 27 / 0.88);
    font-weight: 600;
    font-size: 14px;
    opacity: 0;
  }

  /* Beside the logo rather than over it, which would hide what is being changed. */
  .tag {
    position: absolute;
    left: 100%;
    top: 50%;
    transform: translateY(-50%);
    margin-left: 8px;
    min-height: 44px;
    display: flex;
    align-items: center;
    padding: 0 14px;
    border-radius: 22px;
    background: rgb(20 22 27 / 0.88);
    font-weight: 600;
    font-size: 14px;
    white-space: nowrap;
    opacity: 0;
  }

  .zone:hover .tag,
  .zone:focus-visible .tag,
  .zone:hover .veil,
  .zone:focus-visible .veil,
  .zone:hover .pill,
  .zone:focus-visible .pill {
    opacity: 1;
  }

  .logo {
    position: absolute;
    left: 14px;
    bottom: 12px;
    min-width: 44px;
    min-height: 44px;
    max-width: 40%;
    padding: 6px 8px;
    border: 2px solid transparent;
    border-radius: var(--radius-sm);
  }

  .logo img {
    display: block;
    max-width: 100%;
    max-height: 80px;
  }

  .plain-logo {
    padding: 0;
    max-height: 80px;
    width: auto;
    border: 0;
  }

  .logo.add {
    max-width: none;
    padding: 0 14px;
    border: 2px dashed rgb(255 255 255 / 0.6);
    background: rgb(20 22 27 / 0.6);
    font-weight: 600;
    font-size: 14px;
  }

  .logo:hover,
  .logo:focus-visible {
    border-style: solid;
    border-color: var(--accent);
    background: rgb(10 12 16 / 0.35);
  }

  .logo.add:hover,
  .logo.add:focus-visible {
    border-style: dashed;
    background: rgb(20 22 27 / 0.85);
  }

  .poster-button {
    flex: none;
    width: 92px;
    height: 138px;
    border-radius: 4px;
    overflow: hidden;
  }

  .poster-button .poster {
    display: block;
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

  .kicker {
    font-size: 12.5px;
  }

  p {
    margin: 0;
  }
</style>
