<script lang="ts">
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from '../lib/i18n.svelte.js';
  import { router } from '../lib/router.svelte.js';

  let { sections }: { sections: readonly { id: string; label: string; group: string }[] } =
    $props();

  let active = $state<string | undefined>(undefined);
  // A click scrolls on its own: the sections crossed on the way, or the end of a page too short to
  // bring the chosen one to the top, must not take the highlight. The reader's own scrolling
  // (wheel, touch, keys) hands it back to the scroll position.
  let pinned = false;
  // The address follows the section once the reader has moved the page or clicked the menu: not
  // while the page scrolls itself to the anchor it was opened on, or it would overwrite it.
  let moved = false;

  // The section in the upper part of the screen is the one being read. A short last section never
  // gets there, so the end of the page selects it.
  $effect(() => {
    const visible = new SvelteSet<string>();
    const observer = new IntersectionObserver(
      (changes) => {
        for (const { target, isIntersecting } of changes) {
          if (isIntersecting) {
            visible.add(target.id);
          } else {
            visible.delete(target.id);
          }
        }
        const current = sections.find(({ id }) => visible.has(id));
        if (current && !pinned) {
          active = current.id;
        }
      },
      { rootMargin: '-10% 0px -60% 0px' },
    );
    for (const { id } of sections) {
      const element = document.getElementById(id);
      if (element) {
        observer.observe(element);
      }
    }
    const atEnd = (): void => {
      const last = sections.at(-1);
      if (
        !pinned &&
        last &&
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
      ) {
        active = last.id;
      }
    };
    const unpin = (): void => {
      pinned = false;
      moved = true;
    };
    // The browser scrolls to an anchor typed in the address, or followed from outside, before it
    // tells the page, and that scroll can already have moved the highlight and the address (the end
    // of the page takes the last section). Only a change of anchor fires this event, never our own
    // rewrites of it, so it is where the section asked for gets back the highlight and the address.
    const hashchange = (event: HashChangeEvent): void => {
      const anchor = new URL(event.newURL).hash.slice(1);
      if (sections.some(({ id }) => id === anchor)) {
        active = anchor;
        pinned = true;
        moved = true;
      }
    };
    window.addEventListener('hashchange', hashchange);
    window.addEventListener('scroll', atEnd, { passive: true });
    for (const event of ['wheel', 'touchmove', 'keydown'] as const) {
      window.addEventListener(event, unpin, { passive: true });
    }
    return () => {
      observer.disconnect();
      window.removeEventListener('hashchange', hashchange);
      window.removeEventListener('scroll', atEnd);
      for (const event of ['wheel', 'touchmove', 'keydown'] as const) {
        window.removeEventListener(event, unpin);
      }
    };
  });

  // A section reached is an anchor of the address (`/settings#webhooks`), so the link can be shared
  // and a reload comes back to it. Replaced in place: scrolling must not fill the history.
  $effect(() => {
    if (active !== undefined && moved) {
      router.navigate(`${router.path}${window.location.search}#${active}`, {
        replace: true,
        scroll: false,
      });
    }
  });

  // An anchor that arrives from outside (a link, back/forward) is a click: the browser scrolls to
  // it, and the sections crossed on the way must not take the highlight, then the address, from it.
  $effect(() => {
    const anchor = router.hash.slice(1);
    if (
      anchor !== '' &&
      anchor !== untrack(() => active) &&
      sections.some(({ id }) => id === anchor)
    ) {
      active = anchor;
      pinned = true;
    }
  });

  let bar = $state<HTMLElement | undefined>(undefined);

  // On a narrow screen the nav is a row that overflows: keep the current chip in view. Moving
  // the bar's own scroll (not `scrollIntoView`) leaves the page where it is.
  $effect(() => {
    if (active === undefined || !bar || bar.scrollWidth <= bar.clientWidth) {
      return;
    }
    const chip = bar.querySelector<HTMLElement>('button.current');
    if (chip) {
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      bar.scrollTo({
        left: chip.offsetLeft - (bar.clientWidth - chip.offsetWidth) / 2,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  });

  function go(id: string): void {
    active = id;
    pinned = true;
    moved = true;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  }
</script>

<nav aria-label={t('web.settings.nav.label')} bind:this={bar}>
  <ul>
    {#each sections as section, index (section.id)}
      {#if index === 0 || sections[index - 1]?.group !== section.group}
        <li class="group" aria-hidden="true">{section.group}</li>
      {/if}
      <li>
        <button
          type="button"
          class:current={active === section.id}
          aria-current={active === section.id ? 'true' : undefined}
          onclick={() => {
            go(section.id);
          }}
        >
          {section.label}
        </button>
      </li>
    {/each}
  </ul>
</nav>

<style>
  nav {
    position: sticky;
    top: calc(var(--header-h, 0px) + 24px);
  }

  ul {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
    border-left: 2px solid var(--border);
  }

  .group {
    padding: 14px 12px 4px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .group:first-child {
    padding-top: 0;
  }

  button {
    width: 100%;
    min-height: 36px;
    padding: 6px 12px;
    margin-left: -2px;
    border: 0;
    border-left: 2px solid transparent;
    background: none;
    color: var(--muted);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  button:hover {
    color: var(--text);
  }

  button.current {
    border-left-color: var(--accent);
    color: var(--text);
    font-weight: 600;
  }

  @media (max-width: 1060px) {
    nav {
      top: var(--header-h, 0px);
      z-index: 5;
      padding: 8px 0;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      overflow-x: auto;
      scrollbar-width: none;
    }

    ul {
      flex-direction: row;
      gap: 6px;
      width: max-content;
      border-left: 0;
    }

    .group {
      display: none;
    }

    button {
      width: auto;
      margin: 0;
      border: 1px solid var(--border);
      border-radius: 999px;
      white-space: nowrap;
    }

    button.current {
      border-color: var(--accent);
    }
  }
</style>
