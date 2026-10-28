<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import { router } from '../lib/router.svelte.js';

  let { href, children, ...rest }: HTMLAnchorAttributes & { href: string; children: Snippet } =
    $props();

  function go(event: MouseEvent): void {
    // Let the browser handle a new tab, a download, or a modified click.
    if (
      event.defaultPrevented ||
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
