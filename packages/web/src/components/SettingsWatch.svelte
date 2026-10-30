<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import { FormError, watchForm, watchPatch, type Settings } from '../lib/settings.js';
  import Link from './Link.svelte';
  import SettingsSection from './SettingsSection.svelte';

  let { settings, save }: { settings: Settings; save: (patch: object) => Promise<void> } = $props();

  // Read once: the page replaces nothing under a form being edited.
  /* svelte-ignore state_referenced_locally */
  let form = $state(watchForm(settings.watch));

  const folders = $derived(settings.watch?.folders ?? []);

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

  <div class="libraries">
    <span class="label muted">{t('web.settings.watch.libraries')}</span>
    {#if folders.length === 0}
      <span class="muted">{t('web.settings.watch.none')}</span>
    {:else}
      <ul>
        {#each folders as folder (folder)}
          <li class="mono">{folder}</li>
        {/each}
      </ul>
    {/if}
    <Link href="/libraries">{t('web.settings.watch.manage')}</Link>
    <span class="muted hint">{t('web.settings.watch.folders.hint')}</span>
  </div>

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
</SettingsSection>

<style>
  .libraries {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  .label {
    font-size: 13px;
  }

  ul {
    margin: 0;
    padding-left: 18px;
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
