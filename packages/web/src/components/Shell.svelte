<script lang="ts">
  import type { Snippet } from 'svelte';
  import { isLocale } from '@kinoshelf/i18n';
  import { locale, t } from '../lib/i18n.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { ROUTES } from '../lib/routes.js';
  import { session } from '../lib/session.svelte.js';
  import { theme, type ThemePreference } from '../lib/theme.svelte.js';
  import Link from './Link.svelte';
  import Logo from './Logo.svelte';

  let { children }: { children: Snippet } = $props();

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

<a class="skip" href="#content">{t('web.skip-to-content')}</a>

<header>
  <Link href="/" aria-label="Kinoshelf"><Logo /></Link>

  <nav aria-label={t('web.nav.label')}>
    {#each ROUTES as route (route.id)}
      <Link
        href={route.path}
        class="nav-link"
        aria-current={router.route?.id === route.id ? 'page' : undefined}
      >
        {t(route.label)}
        {#if route.soon}<span class="chip chip-neutral">{t('web.soon.badge')}</span>{/if}
      </Link>
    {/each}
  </nav>

  <div class="tools">
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
    max-width: 1280px;
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

  @media (max-width: 640px) {
    header {
      padding: 12px 16px;
    }

    main {
      padding: 16px;
    }
  }
</style>
