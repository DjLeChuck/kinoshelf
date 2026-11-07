<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import {
    METADATAS,
    NAMINGS,
    type Metadata,
    type Naming,
    type NamingExample,
  } from '../lib/settings.js';

  let {
    naming = $bindable(''),
    metadata = $bindable(''),
    examples,
    withDefault = false,
    id,
  }: {
    /** `''` is "as in the settings", offered only with `withDefault`. */
    naming?: Naming | '';
    metadata?: Metadata | '';
    examples: Readonly<Record<Naming, NamingExample>>;
    /** A library may follow the global choice; the global one cannot. */
    withDefault?: boolean;
    /** Keeps the ids and the radio groups of two forms on one page apart. */
    id: string;
  } = $props();
</script>

<fieldset>
  <legend id="{id}-naming">{t('web.profile.naming')}</legend>
  <span class="muted hint">{t('web.profile.naming.hint')}</span>
  <div class="cards" role="radiogroup" aria-labelledby="{id}-naming">
    {#if withDefault}
      <label class="option" class:on={naming === ''}>
        <input type="radio" name="{id}-naming" value="" bind:group={naming} />
        <span class="option-name">{t('web.profile.default')}</span>
        <span class="muted hint">{t('web.profile.default.help')}</span>
      </label>
    {/if}
    {#each NAMINGS as choice (choice)}
      <label class="option" class:on={naming === choice}>
        <input type="radio" name="{id}-naming" value={choice} bind:group={naming} />
        <span class="option-name">{t(`web.profile.naming.${choice}`)}</span>
        <span class="muted hint">{t(`web.profile.naming.${choice}.help`)}</span>
        <code class="example">{examples[choice].movie}</code>
        <code class="example">{examples[choice].series}</code>
      </label>
    {/each}
  </div>
</fieldset>

<fieldset>
  <legend id="{id}-metadata">{t('web.profile.metadata')}</legend>
  <span class="muted hint">{t('web.profile.metadata.hint')}</span>
  <div class="cards" role="radiogroup" aria-labelledby="{id}-metadata">
    {#if withDefault}
      <label class="option" class:on={metadata === ''}>
        <input type="radio" name="{id}-metadata" value="" bind:group={metadata} />
        <span class="option-name">{t('web.profile.default')}</span>
        <span class="muted hint">{t('web.profile.default.help')}</span>
      </label>
    {/if}
    {#each METADATAS as choice (choice)}
      <label class="option" class:on={metadata === choice}>
        <input type="radio" name="{id}-metadata" value={choice} bind:group={metadata} />
        <span class="option-name">{t(`web.profile.metadata.${choice}`)}</span>
        <span class="muted hint">{t(`web.profile.metadata.${choice}.help`)}</span>
      </label>
    {/each}
  </div>
</fieldset>

<style>
  fieldset {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0;
    margin-bottom: 4px;
    color: var(--muted);
    font-size: 13px;
  }

  .example {
    font-size: 11.5px;
    overflow-wrap: anywhere;
  }
</style>
