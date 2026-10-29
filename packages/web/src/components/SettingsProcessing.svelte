<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import {
    FormError,
    CUSTOM_PROFILE,
    MODES,
    destinationForm,
    destinationOf,
    profileForm,
    profileOf,
    thresholdOf,
    type Mode,
    type Settings,
  } from '../lib/settings.js';
  import PathField from './PathField.svelte';
  import SettingsSection from './SettingsSection.svelte';

  let { settings, save }: { settings: Settings; save: (patch: object) => Promise<void> } = $props();

  const EXPLAINED: readonly ('default' | Mode)[] = ['default', ...MODES];

  // Read once: the page replaces nothing under a form being edited.
  /* svelte-ignore state_referenced_locally */
  const { processing } = settings;
  /* svelte-ignore state_referenced_locally */
  let profile = $state(profileForm(processing.profile, settings.profiles));
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
    const chosen = profileOf(profile);
    if (chosen === undefined) {
      throw new FormError(t('web.settings.invalid.profile'));
    }
    await save({
      processing: {
        profile: chosen,
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
    <select id="profile" class="input" bind:value={profile.choice}>
      <option value="">{t('web.settings.processing.profile.default')}</option>
      {#each settings.profiles as option (option.id)}
        <option value={option.id}>{option.name}</option>
      {/each}
      <option value={CUSTOM_PROFILE}>{t('web.settings.processing.profile.custom')}</option>
    </select>
    <span class="muted hint">{t('web.settings.processing.profile.hint')}</span>
  </div>

  {#if profile.choice === CUSTOM_PROFILE}
    <div class="field sub">
      <label for="profile-path">{t('web.settings.processing.profile.path')}</label>
      <PathField
        id="profile-path"
        kind="file"
        placeholder="/config/my-profile.yaml"
        bind:value={profile.path}
      />
      <span class="muted hint">{t('web.settings.processing.profile.path.hint')}</span>
    </div>
  {/if}

  <div class="field">
    <label for="mode">{t('web.settings.processing.mode')}</label>
    <select id="mode" class="input" bind:value={mode}>
      <option value="">{t('web.settings.processing.mode.default')}</option>
      {#each MODES as option (option)}
        <option value={option}>{t(`web.settings.processing.mode.${option}`)}</option>
      {/each}
    </select>
  </div>

  <dl class="explain" aria-label={t('web.settings.processing.mode.explain')}>
    {#each EXPLAINED as option (option)}
      <div class:current={option === (mode === '' ? 'default' : mode)}>
        <dt>{t(`web.settings.processing.mode.${option}`)}</dt>
        <dd class="muted">{t(`web.settings.processing.mode.${option}.help`)}</dd>
      </div>
    {/each}
  </dl>

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
    <span class="muted hint">{t('web.settings.processing.destination.hint')}</span>
    <div class="choices">
      <label class="check">
        <input type="radio" name="destination-kind" value={false} bind:group={folders.separate} />
        {t('web.settings.processing.destination.single')}
      </label>
      <label class="check">
        <input type="radio" name="destination-kind" value={true} bind:group={folders.separate} />
        {t('web.settings.processing.destination.separate')}
      </label>
    </div>

    {#if folders.separate}
      <div class="field">
        <label for="dest-movies">{t('web.settings.processing.destination.movies')}</label>
        <PathField id="dest-movies" bind:value={folders.movies} />
      </div>
      <div class="field">
        <label for="dest-series">{t('web.settings.processing.destination.series')}</label>
        <PathField id="dest-series" bind:value={folders.series} />
      </div>
    {:else}
      <div class="field">
        <label class="sr-only" for="dest-single">{t('web.settings.processing.destination')}</label>
        <PathField id="dest-single" bind:value={folders.single} />
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

  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 24px;
  }

  /* A field that belongs to the one above it. */
  .sub {
    margin-left: 16px;
    padding-left: 12px;
    border-left: 2px solid var(--border);
  }

  .explain {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    font-size: 12.5px;
  }

  .explain > div {
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .explain > .current {
    border-color: var(--accent);
    background: var(--warn-bg);
  }

  dt {
    font-weight: 600;
  }

  dd {
    margin: 2px 0 0;
  }
</style>
