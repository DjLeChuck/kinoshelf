<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import type { PathMapping } from '../lib/settings.js';
  import PathField from './PathField.svelte';

  let {
    rows = $bindable([]),
    idPrefix,
  }: {
    rows?: PathMapping[];
    /** Tells apart the mappings of two servers shown on the same page. */
    idPrefix: string;
  } = $props();
</script>

<fieldset>
  <legend>{t('web.settings.server.paths')}</legend>
  <p class="muted hint">{t('web.settings.server.paths.hint')}</p>
  {#each rows as row, index (index)}
    <div class="mapping">
      <div class="row">
        <div class="field">
          <label for="{idPrefix}-map-from-{index}">{t('web.settings.server.from')}</label>
          <PathField id="{idPrefix}-map-from-{index}" bind:value={row.from} />
        </div>
        <div class="field">
          <label for="{idPrefix}-map-to-{index}">{t('web.settings.server.to')}</label>
          <input id="{idPrefix}-map-to-{index}" class="input mono" bind:value={row.to} />
        </div>
        <button
          type="button"
          class="btn"
          onclick={() => {
            rows = rows.filter((_, i) => i !== index);
          }}>{t('web.settings.remove')}</button
        >
      </div>
    </div>
  {/each}
  <button
    type="button"
    class="btn"
    onclick={() => {
      rows = [...rows, { from: '', to: '' }];
    }}>{t('web.settings.server.add-path')}</button
  >
</fieldset>

<style>
  fieldset {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0;
    font-weight: 600;
  }

  .mapping {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px;
  }

  .field {
    flex: 1 1 180px;
  }

  fieldset > .btn {
    align-self: flex-start;
  }
</style>
