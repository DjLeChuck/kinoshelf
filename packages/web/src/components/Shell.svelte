<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import type { Action } from 'svelte/action';
  import { isLocale } from '@kinoshelf/i18n';
  import { activity } from '../lib/activity.svelte.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { ROUTES } from '../lib/routes.js';
  import { session } from '../lib/session.svelte.js';
  import { shell } from '../lib/shell-state.svelte.js';
  import { theme, type ThemePreference } from '../lib/theme.svelte.js';
  import ActivityTray from './ActivityTray.svelte';
  import BackToTop from './BackToTop.svelte';
  import Link from './Link.svelte';
  import Logo from './Logo.svelte';
  import Tip from './Tip.svelte';

  let { children }: { children: Snippet } = $props();

  // It feeds the nav and the root page, so it is fetched once, here.
  refetchOn(['settings', 'ready'], () => void shell.loadOnboarding());
  refetchOn(['arrivals', 'jobs', 'settings', 'ready'], () => void shell.loadArrivals());
  refetchOn(['health', 'ready'], () => void shell.loadHealth());
  // The panel shows what runs wherever the person is, so it reads at every event that moves a task.
  refetchOn(['progress', 'jobs', 'history', 'ready'], () => void activity.load());

  // Until the welcome page is left only what it needs is shown; unknown, everything is.
  const routes = $derived(
    shell.onboarding?.completed === false ? ROUTES.filter((route) => route.firstRun) : ROUTES,
  );

  onDestroy(() => {
    activity.clear();
  });

  // The header wraps on a narrow screen, so its height is measured: whatever sticks below it
  // (a side panel, the settings nav) reads `--header-h` to start under it.
  const measure: Action = (node) => {
    const publish = (): void => {
      document.documentElement.style.setProperty('--header-h', `${node.offsetHeight}px`);
    };
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    publish();
    return {
      destroy() {
        observer.disconnect();
        document.documentElement.style.removeProperty('--header-h');
      },
    };
  };

  // On a phone the theme, the language and the sign-out fold behind a button: the header is then
  // the logo and one line of menus rather than a third of the screen.
  let toolsOpen = $state(false);

  let toggleEl = $state<HTMLButtonElement | undefined>(undefined);

  function closeTools(refocus = false): void {
    toolsOpen = false;
    if (refocus) {
      toggleEl?.focus();
    }
  }

  const themes: readonly ThemePreference[] = ['dark', 'light', 'system'];

  function pickLocale(event: Event & { currentTarget: HTMLSelectElement }): void {
    const { value } = event.currentTarget;
    if (isLocale(value)) {
      locale.set(value);
    }
  }

  function pickTheme(event: Event & { currentTarget: HTMLSelectElement }): void {
    theme.set(event.currentTarget.value as ThemePreference);
  }
</script>

<svelte:window
  onkeydown={(event: KeyboardEvent) => {
    if (event.key === 'Escape' && toolsOpen) {
      closeTools(true);
    }
  }}
  onclick={(event: MouseEvent) => {
    // A click anywhere else puts the menu away.
    if (
      toolsOpen &&
      event.target instanceof Element &&
      !event.target.closest('.tools, .tools-toggle')
    ) {
      closeTools();
    }
  }}
/>

<a class="skip" href="#content">{t('web.skip-to-content')}</a>

<header use:measure>
  <Link href="/" class="home" aria-label="Kinoshelf"><Logo /></Link>

  <button
    type="button"
    class="tools-toggle"
    bind:this={toggleEl}
    aria-expanded={toolsOpen}
    aria-controls="header-tools"
    aria-label={t('web.nav.tools')}
    onclick={() => {
      toolsOpen = !toolsOpen;
    }}
  >
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="19" cy="12" r="1.8" fill="currentColor" />
    </svg>
  </button>

  <nav aria-label={t('web.nav.label')}>
    {#each routes as route (route.id)}
      <Link
        href={route.path}
        class="nav-link"
        aria-current={router.route?.id === route.id ? 'page' : undefined}
      >
        {t(route.label)}
        {#if route.id === 'libraries' && (shell.arrivals ?? 0) > 0}<span class="chip chip-warn"
            >{shell.arrivals}</span
          >{/if}
        {#if route.id === 'system' && (shell.healthErrors ?? 0) > 0}<Tip
            text={t('web.nav.systemErrors', { count: shell.healthErrors ?? 0 })}
          >
            {#snippet children(describedby)}
              <span class="chip chip-danger" aria-describedby={describedby}
                >{shell.healthErrors}<span class="sr-only"
                  >{t('web.nav.systemErrors', { count: shell.healthErrors ?? 0 })}</span
                ></span
              >
            {/snippet}
          </Tip>{/if}
      </Link>
    {/each}
  </nav>

  <div class="tools" id="header-tools" class:open={toolsOpen}>
    {#if shell.onboarding?.completed === false}
      <span class="chip chip-warn">{t('web.welcome.status')}</span>
    {/if}
    <label>
      <span class="sr-only">{t('web.theme.label')}</span>
      <select class="input" value={theme.preference} onchange={pickTheme}>
        {#each themes as option (option)}
          <option value={option}>{t(`web.theme.${option}`)}</option>
        {/each}
      </select>
    </label>
    <label>
      <span class="sr-only">{t('web.locale.label')}</span>
      <select class="input" value={locale.value} onchange={pickLocale}>
        <option value="fr">Français</option>
        <option value="en">English</option>
      </select>
    </label>
    <button type="button" class="btn" onclick={() => void session.signOut()}>
      {t('web.signout')}
    </button>
  </div>
</header>

<main id="content" tabindex="-1">{@render children()}</main>

<ActivityTray />
<BackToTop />

<footer class="muted">{t('web.tmdb-attribution')}</footer>

<style>
  .skip {
    position: absolute;
    left: 8px;
    top: -60px;
    z-index: 10;
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--on-accent);
  }

  .skip:focus {
    top: 8px;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 24px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--border);
    /* Kept in view so the menus stay one click away on a long page. */
    position: sticky;
    top: 0;
    z-index: 20;
    background: var(--bg);
  }

  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  nav :global(.nav-link) {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 14px;
    border-radius: var(--radius-sm);
    color: var(--muted);
    text-decoration: none;
  }

  nav :global(.nav-link:hover) {
    background: var(--surface-2);
    color: var(--text);
  }

  nav :global(.nav-link[aria-current='page']) {
    background: var(--surface-2);
    color: var(--text);
    font-weight: 600;
  }

  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  main {
    flex: 1;
    width: 100%;
    /* One width for every page, so the content does not jump when changing page. */
    max-width: 1440px;
    margin: 0 auto;
    padding: 24px;
  }

  main:focus {
    outline: none;
  }

  footer {
    padding: 16px 24px 24px;
    font-size: 12px;
    text-align: center;
  }

  .tools-toggle {
    display: none;
  }

  /* Where the logo, the menus and the tools no longer fit on a line, the theme, the language and
     the sign-out fold behind a button: the header stays one line (two on a phone). */
  @media (max-width: 1080px) {
    header :global(.home) {
      margin-right: auto;
    }

    .tools-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      order: 2;
    }

    .tools-toggle:hover,
    .tools-toggle[aria-expanded='true'] {
      background: var(--surface-2);
      color: var(--text);
    }

    nav {
      order: 1;
    }

    /* A menu hanging from the button, over the menus and the page, not a block that pushes them
       down: the header's padding and the button's height, then a gap. */
    .tools {
      position: absolute;
      top: 60px;
      right: 16px;
      z-index: 25;
      display: none;
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
      min-width: 220px;
      padding: 12px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--surface);
      box-shadow: 0 6px 24px rgb(0 0 0 / 35%);
    }

    .tools.open {
      display: flex;
    }
  }

  @media (max-width: 640px) {
    header {
      gap: 4px 8px;
      padding: 8px 16px;
    }

    .tools {
      top: 56px;
    }

    /* The menus take a line of their own, scrolled sideways if the labels outgrow the screen. */
    nav {
      scrollbar-width: none;
      order: 2;
      flex: 0 0 100%;
      flex-wrap: nowrap;
      margin: 0 -8px;
      overflow-x: auto;
    }

    .tools-toggle {
      order: 1;
    }

    nav :global(.nav-link) {
      flex: none;
      min-height: 40px;
      padding: 0 12px;
      font-size: 14px;
    }

    main {
      padding: 16px;
    }
  }
</style>
