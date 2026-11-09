<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import type { Coverage } from '../lib/library-items.js';
  import { isIncomplete } from '../lib/versions.js';

  // The versions of a show, each with how much of it they hold. A show's row shows the ratio only
  // where a version falls short; a season's always does, green when it holds every episode.
  let { coverage, always = false }: { coverage: readonly Coverage[]; always?: boolean } = $props();

  const kind = (version: Coverage): string =>
    isIncomplete(version) ? 'chip-warn' : always ? 'chip-ok' : 'chip-neutral';
</script>

<span class="badges">
  {#each coverage as version (version.resolution ?? '')}
    {@const ratio = always || isIncomplete(version)}
    <span class="chip {kind(version)}"
      >{[
        version.resolution ?? t('web.library.version.unknown'),
        ratio ? `${version.covered}/${version.total}` : '',
      ]
        .filter(Boolean)
        .join(' ')}</span
    >
  {/each}
</span>

<style>
  .badges {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 6px;
  }
</style>
