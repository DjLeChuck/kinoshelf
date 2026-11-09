<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import type { Version } from '../lib/library-items.js';
  import { versionLabel } from '../lib/versions.js';

  // One badge per version of a work: its size, then its dynamic range once ffprobe has read it.
  let { versions }: { versions: readonly Pick<Version, 'id' | 'resolution' | 'file'>[] } = $props();
</script>

<span class="badges">
  {#each versions as version (version.id)}
    {@const label = versionLabel(version.resolution, version.file)}
    <span class="chip chip-neutral"
      >{label.length > 0 ? label.join(' ') : t('web.library.version.unknown')}</span
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
