<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import type { PathMapping } from '../lib/settings.js';
  import FolderBrowser from './FolderBrowser.svelte';
  import PathField from './PathField.svelte';

  let {
    rows = $bindable([]),
    idPrefix,
  }: {
    rows?: PathMapping[];
    /** Tells apart the mappings of two servers shown on the same page. */
    idPrefix: string;
  } = $props();

  /** The row whose folder browser is open: shown under the whole row, not in its narrow column. */
  let browsing = $state<number | undefined>(undefined);
</script>

<fieldset>
  <legend>{t('web.settings.server.paths')}</legend>
  <p class="muted hint">{t('web.settings.server.paths.hint')}</p>
  {#each rows as row, index (index)}
    <div class="mapping">
      <div class="row">
        <div class="field">
          <label for="{idPrefix}-map-from-{index}">{t('web.settings.server.from')}</label>
          <PathField
            id="{idPrefix}-map-from-{index}"
            inline={false}
            bind:value={row.from}
            bind:open={
              () => browsing === index,
              (open) => {
                browsing = open ? index : undefined;
              }
            }
          />
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
            browsing = undefined;
          }}>{t('web.settings.remove')}</button
        >
      </div>
      {#if browsing === index}
        <FolderBrowser
          id="{idPrefix}-map-from-{index}"
          start={row.from}
          onchoose={(path: string) => {
            row.from = path;
            browsing = undefined;
          }}
          onclose={() => {
            browsing = undefined;
          }}
        />
      {/if}
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

  .hint {
    font-size: 12px;
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
