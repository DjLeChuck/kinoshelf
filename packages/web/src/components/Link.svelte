<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import { router } from '../lib/router.svelte.js';
  import { isInternal } from '../lib/routes.js';

  let { href, children, ...rest }: HTMLAnchorAttributes & { href: string; children: Snippet } =
    $props();

  function go(event: MouseEvent): void {
    // Let the browser handle a new tab, an address outside the app, a download, or a modified click.
    if (
      event.defaultPrevented ||
      (rest.target !== undefined && rest.target !== '_self') ||
      !isInternal(href) ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    router.navigate(href);
  }
</script>

<a {href} onclick={go} {...rest}>{@render children()}</a>
