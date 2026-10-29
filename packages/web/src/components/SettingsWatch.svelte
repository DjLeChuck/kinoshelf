<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import { FormError, watchForm, watchPatch, type Settings } from '../lib/settings.js';
  import PathField from './PathField.svelte';
  import SettingsSection from './SettingsSection.svelte';

  let { settings, save }: { settings: Settings; save: (patch: object) => Promise<void> } = $props();

  // Read once: the page replaces nothing under a form being edited.
  /* svelte-ignore state_referenced_locally */
  let form = $state(watchForm(settings.watch));

  async function submit(): Promise<void> {
    const patch = watchPatch(form);
    if ('invalid' in patch) {
      throw new FormError(t(`web.settings.invalid.watch-${patch.invalid}`));
    }
    await save(patch);
  }
</script>

<SettingsSection title={t('web.settings.watch.title')} onsubmit={submit}>
  <p class="muted hint">{t('web.settings.watch.intro')}</p>

  <label class="check">
    <input type="checkbox" bind:checked={form.enabled} />
    {t('web.settings.watch.enabled')}
  </label>

  {#if form.enabled}
    <fieldset>
      <legend>{t('web.settings.watch.folders')}</legend>
      {#each form.folders as folder, index (index)}
        <div class="folder">
          <label class="sr-only" for="watch-folder-{index}">{t('web.settings.watch.folders')}</label
          >
          <PathField id="watch-folder-{index}" bind:value={folder.path} />
          {#if form.folders.length > 1}
            <button
              type="button"
              class="btn"
              onclick={() => {
                form.folders = form.folders.filter((_, i) => i !== index);
              }}>{t('web.settings.remove')}</button
            >
          {/if}
        </div>
      {/each}
      <button
        type="button"
        class="btn add"
        onclick={() => {
          form.folders = [...form.folders, { path: '' }];
        }}>{t('web.settings.watch.add-folder')}</button
      >
      <span class="muted hint">{t('web.settings.watch.folders.hint')}</span>
    </fieldset>

    <div class="field">
      <label for="watch-settle">{t('web.settings.watch.settle')}</label>
      <input
        id="watch-settle"
        class="input"
        inputmode="numeric"
        placeholder="30"
        bind:value={form.settle}
      />
      <span class="muted hint">{t('web.settings.watch.settle.hint')}</span>
    </div>

    <div class="field">
      <label for="watch-poll">{t('web.settings.watch.poll')}</label>
      <input
        id="watch-poll"
        class="input"
        inputmode="numeric"
        placeholder="0"
        bind:value={form.poll}
      />
      <span class="muted hint">{t('web.settings.watch.poll.hint')}</span>
    </div>

    <label class="check">
      <input type="checkbox" bind:checked={form.apply} />
      {t('web.settings.watch.apply')}
    </label>
    <span class="muted hint">{t('web.settings.watch.apply.hint')}</span>
  {/if}
</SettingsSection>

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

  .folder {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .add {
    align-self: flex-start;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
  }

  .hint {
    font-size: 12px;
  }
</style>
