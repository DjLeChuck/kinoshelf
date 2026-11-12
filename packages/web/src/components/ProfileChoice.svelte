<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import {
    DEFAULT_METADATA,
    DEFAULT_NAMING,
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
    defaults = { naming: DEFAULT_NAMING, metadata: DEFAULT_METADATA },
    id,
  }: {
    /** `''` is "as in the settings", offered only with `withDefault`. */
    naming?: Naming | '';
    metadata?: Metadata | '';
    examples: Readonly<Record<Naming, NamingExample>>;
    /** A library may follow the global choice; the global one cannot. */
    withDefault?: boolean;
    /** What `''` stands for: the global choice, so "Default" says what it does. */
    defaults?: { naming: Naming; metadata: Metadata };
    /** Keeps the ids and the radio groups of two forms on one page apart. */
    id: string;
  } = $props();

  const shownNaming = $derived(naming === '' ? defaults.naming : naming);
  const shownMetadata = $derived(metadata === '' ? defaults.metadata : metadata);
</script>

<fieldset>
  <legend id="{id}-naming">{t('web.profile.naming')}</legend>
  <div class="segments" role="radiogroup" aria-labelledby="{id}-naming">
    {#if withDefault}
      <label class="segment" class:on={naming === ''}>
        <input type="radio" name="{id}-naming" value="" bind:group={naming} />
        {t('web.profile.default.named', { value: t(`web.profile.naming.${defaults.naming}`) })}
      </label>
    {/if}
    {#each NAMINGS as choice (choice)}
      <label class="segment" class:on={naming === choice}>
        <input type="radio" name="{id}-naming" value={choice} bind:group={naming} />
        {t(`web.profile.naming.${choice}`)}
      </label>
    {/each}
  </div>
  <div class="segment-detail" aria-live="polite">
    <span class="muted hint">{t(`web.profile.naming.${shownNaming}.help`)}</span>
    <code class="example">{examples[shownNaming].movie}</code>
    <code class="example">{examples[shownNaming].series}</code>
  </div>
</fieldset>

<fieldset>
  <legend id="{id}-metadata">{t('web.profile.metadata')}</legend>
  <div class="segments" role="radiogroup" aria-labelledby="{id}-metadata">
    {#if withDefault}
      <label class="segment" class:on={metadata === ''}>
        <input type="radio" name="{id}-metadata" value="" bind:group={metadata} />
        {t('web.profile.default.named', { value: t(`web.profile.metadata.${defaults.metadata}`) })}
      </label>
    {/if}
    {#each METADATAS as choice (choice)}
      <label class="segment" class:on={metadata === choice}>
        <input type="radio" name="{id}-metadata" value={choice} bind:group={metadata} />
        {t(`web.profile.metadata.${choice}`)}
      </label>
    {/each}
  </div>
  <div class="segment-detail" aria-live="polite">
    <span class="muted hint">{t(`web.profile.metadata.${shownMetadata}.help`)}</span>
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
</style>
