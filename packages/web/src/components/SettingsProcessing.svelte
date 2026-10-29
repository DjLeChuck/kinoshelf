<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import {
    FormError,
    MODES,
    destinationForm,
    destinationOf,
    nullIfBlank,
    thresholdOf,
    type Mode,
    type Settings,
  } from '../lib/settings.js';
  import SettingsSection from './SettingsSection.svelte';

  let { settings, save }: { settings: Settings; save: (patch: object) => Promise<void> } = $props();

  // Read once: the page replaces nothing under a form being edited.
  /* svelte-ignore state_referenced_locally */
  const { processing } = settings;
  let profile = $state(processing.profile ?? '');
  let mode = $state<Mode | ''>(processing.mode ?? '');
  let threshold = $state(processing.threshold === null ? '' : String(processing.threshold));
  let folders = $state(destinationForm(processing.destination));

  async function submit(): Promise<void> {
    const limit = thresholdOf(threshold);
    if (limit === undefined) {
      throw new FormError(t('web.settings.invalid.threshold'));
    }
    const destination = destinationOf(folders);
    if (destination === undefined) {
      throw new FormError(t('web.settings.invalid.destination'));
    }
    await save({
      processing: {
        profile: nullIfBlank(profile),
        mode: mode === '' ? null : mode,
        threshold: limit,
        destination,
      },
    });
  }
</script>

<SettingsSection title={t('web.settings.processing.title')} onsubmit={submit}>
  <div class="field">
    <label for="profile">{t('web.settings.processing.profile')}</label>
    <input id="profile" class="input mono" bind:value={profile} placeholder="plex" />
    <span class="muted hint">{t('web.settings.processing.profile.hint')}</span>
  </div>

  <div class="field">
    <label for="mode">{t('web.settings.processing.mode')}</label>
    <select id="mode" class="input" bind:value={mode}>
      <option value="">{t('web.settings.processing.mode.default')}</option>
      {#each MODES as option (option)}
        <option value={option}>{t(`web.settings.processing.mode.${option}`)}</option>
      {/each}
    </select>
  </div>

  <div class="field">
    <label for="threshold">{t('web.settings.processing.threshold')}</label>
    <input
      id="threshold"
      class="input"
      inputmode="decimal"
      placeholder="85"
      bind:value={threshold}
    />
    <span class="muted hint">{t('web.settings.processing.threshold.hint')}</span>
  </div>

  <fieldset>
    <legend>{t('web.settings.processing.destination')}</legend>
    <label class="check">
      <input type="radio" name="destination-kind" value={false} bind:group={folders.separate} />
      {t('web.settings.processing.destination.single')}
    </label>
    <label class="check">
      <input type="radio" name="destination-kind" value={true} bind:group={folders.separate} />
      {t('web.settings.processing.destination.separate')}
    </label>

    {#if folders.separate}
      <div class="field">
        <label for="dest-movies">{t('web.settings.processing.destination.movies')}</label>
        <input id="dest-movies" class="input mono" bind:value={folders.movies} />
      </div>
      <div class="field">
        <label for="dest-series">{t('web.settings.processing.destination.series')}</label>
        <input id="dest-series" class="input mono" bind:value={folders.series} />
      </div>
    {:else}
      <div class="field">
        <label class="sr-only" for="dest-single">{t('web.settings.processing.destination')}</label>
        <input id="dest-single" class="input mono" bind:value={folders.single} />
      </div>
    {/if}
  </fieldset>
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
