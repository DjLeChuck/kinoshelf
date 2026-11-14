<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from '../lib/i18n.svelte.js';
  import { router } from '../lib/router.svelte.js';

  let { sections }: { sections: readonly { id: string; label: string }[] } = $props();

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
    window.addEventListener('scroll', atEnd, { passive: true });
    for (const event of ['wheel', 'touchmove', 'keydown'] as const) {
      window.addEventListener(event, unpin, { passive: true });
    }
    return () => {
      observer.disconnect();
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

<nav aria-label={t('web.settings.nav.label')}>
  <ul>
    {#each sections as section (section.id)}
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
    top: 24px;
  }

  ul {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
    border-left: 2px solid var(--border);
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
</style>
