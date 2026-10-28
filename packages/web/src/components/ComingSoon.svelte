<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';

  type Kind = 'media' | 'libraries' | 'scan';
  let { kinds }: { kinds: readonly Kind[] } = $props();
</script>

<div class="soon">
  {#each kinds as kind (kind)}
    <section class="card">
      <div class="head">
        <h1>{t(`web.soon.${kind}.title`)}</h1>
        <span class="chip chip-neutral">{t('web.soon.badge')}</span>
      </div>
      <p class="muted">{t(`web.soon.${kind}.body`)}</p>
    </section>
  {/each}
</div>

<style>
  .soon {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 640px;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }

  h1 {
    font-size: 20px;
  }
</style>
