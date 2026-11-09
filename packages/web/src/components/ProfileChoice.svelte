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
  <div class="segments" role="radiogroup" aria-labelledby="{id}-naming">
    {#if withDefault}
      <label class="segment" class:on={naming === ''}>
        <input type="radio" name="{id}-naming" value="" bind:group={naming} />
        {t('web.profile.default')}
      </label>
    {/if}
    {#each NAMINGS as choice (choice)}
      <label class="segment" class:on={naming === choice}>
        <input type="radio" name="{id}-naming" value={choice} bind:group={naming} />
        {t(`web.profile.naming.${choice}`)}
      </label>
    {/each}
  </div>
  <div class="detail" aria-live="polite">
    {#if naming === ''}
      <span class="muted hint">{t('web.profile.default.help')}</span>
    {:else}
      <span class="muted hint">{t(`web.profile.naming.${naming}.help`)}</span>
      <code class="example">{examples[naming].movie}</code>
      <code class="example">{examples[naming].series}</code>
    {/if}
  </div>
</fieldset>

<fieldset>
  <legend id="{id}-metadata">{t('web.profile.metadata')}</legend>
  <span class="muted hint">{t('web.profile.metadata.hint')}</span>
  <div class="segments" role="radiogroup" aria-labelledby="{id}-metadata">
    {#if withDefault}
      <label class="segment" class:on={metadata === ''}>
        <input type="radio" name="{id}-metadata" value="" bind:group={metadata} />
        {t('web.profile.default')}
      </label>
    {/if}
    {#each METADATAS as choice (choice)}
      <label class="segment" class:on={metadata === choice}>
        <input type="radio" name="{id}-metadata" value={choice} bind:group={metadata} />
        {t(`web.profile.metadata.${choice}`)}
      </label>
    {/each}
  </div>
  <div class="detail" aria-live="polite">
    <span class="muted hint"
      >{metadata === ''
        ? t('web.profile.default.help')
        : t(`web.profile.metadata.${metadata}.help`)}</span
    >
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

  /* One choice per line of the segmented control; the radio stays for the keyboard. */
  .segments {
    display: flex;
    flex-wrap: wrap;
    align-self: flex-start;
    max-width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .segment {
    position: relative;
    display: flex;
    align-items: center;
    min-height: 44px;
    padding: 0 16px;
    font-weight: 600;
    cursor: pointer;
  }

  .segment + .segment {
    border-left: 1px solid var(--border);
  }

  .segment:hover {
    background: var(--surface-2);
  }

  .segment.on {
    background: var(--warn-bg);
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .segment input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }

  .segment:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  /* What the selected choice means, and what it writes. */
  .detail {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border-left: 2px solid var(--accent);
    background: var(--surface-2);
    border-radius: var(--radius-sm);
  }

  .example {
    font-size: 11.5px;
    overflow-wrap: anywhere;
  }
</style>
