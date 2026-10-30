<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import {
    FormError,
    CUSTOM_PROFILE,
    MODES,
    destinationForm,
    destinationOf,
    profileForm,
    profileHelp,
    profileName,
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

  // The default is Plex; "my own file" is the user's to explain.
  const shown = $derived(
    settings.profiles.find(({ id }) => id === (profile.choice === '' ? 'plex' : profile.choice)),
  );

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
        <option value={option.id}>{profileName(option, t)}</option>
      {/each}
      <option value={CUSTOM_PROFILE}>{t('web.settings.processing.profile.custom')}</option>
    </select>
    <span class="muted hint">{t('web.settings.processing.profile.hint')}</span>
  </div>

  {#if shown}
    <div class="profile-box" role="group" aria-label={t('web.settings.processing.profile.explain')}>
      {#if profileHelp(shown.id, t)}
        <p class="muted">{profileHelp(shown.id, t)}</p>
      {/if}
      <dl class="layout">
        <dt class="muted">{t('web.settings.processing.profile.example.movie')}</dt>
        <dd><code>{shown.example.movie}</code></dd>
        <dt class="muted">{t('web.settings.processing.profile.example.series')}</dt>
        <dd><code>{shown.example.series}</code></dd>
      </dl>
    </div>
  {/if}

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

  <fieldset>
    <legend id="mode-legend">{t('web.settings.processing.mode')}</legend>
    <div class="cards" role="radiogroup" aria-labelledby="mode-legend">
      {#each EXPLAINED as option (option)}
        <label class="option" class:on={option === (mode === '' ? 'default' : mode)}>
          <input
            type="radio"
            name="mode"
            value={option === 'default' ? '' : option}
            bind:group={mode}
          />
          <span class="option-name">{t(`web.settings.processing.mode.${option}`)}</span>
          <span class="muted hint">{t(`web.settings.processing.mode.${option}.help`)}</span>
        </label>
      {/each}
    </div>
  </fieldset>

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

  /* Four cards: two by two rather than three and one. */
  .cards {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  @media (max-width: 560px) {
    .cards {
      grid-template-columns: 1fr;
    }
  }

  .option {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 44px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .option:hover {
    background: var(--surface-2);
  }

  .option.on {
    border-color: var(--accent);
    background: var(--warn-bg);
  }

  /* The radio stays in the page for the keyboard and screen readers; the card is what is seen. */
  .option input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }

  .option:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .option-name {
    font-weight: 600;
  }

  .profile-box {
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 12.5px;
  }

  .profile-box p {
    margin: 0 0 8px;
  }

  .layout {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 12px;
    margin: 0;
  }

  .layout dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  dt {
    font-weight: 600;
  }

  dd {
    margin: 2px 0 0;
  }
</style>
