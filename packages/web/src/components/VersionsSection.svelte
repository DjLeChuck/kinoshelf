<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../lib/i18n.svelte.js';

  // The Versions section of the three sheets, set apart from the facts by a rule: its header
  // carries the summary (`Versions · 2 · 31.6 GiB`), the body is the caller's (a table, a grid).
  let { summary, children }: { summary: readonly string[]; children: Snippet } = $props();
  // One string: spaces between inline elements are collapsed by the template, so the separators
  // are written here.
  const tail = $derived(summary.map((part) => ` · ${part}`).join(''));
</script>

<section class="versions" aria-labelledby="versions-title">
  <h3 id="versions-title">
    {t('web.library.versions.title')}<span class="muted">{tail}</span>
  </h3>
  <div class="body">
    {@render children()}
  </div>
</section>

<style>
  .versions {
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  h3 {
    margin: 0 0 8px;
    font-size: 14px;
  }

  /* The versions scroll on their own, so a long list (tracks, subtitles) does not push the rest of
     the sheet out of view: the identity and the synopsis stay where they are. */
  .body {
    max-height: max(260px, 45vh);
    overflow-y: auto;
  }

  h3 .muted {
    font-weight: 400;
  }
</style>
