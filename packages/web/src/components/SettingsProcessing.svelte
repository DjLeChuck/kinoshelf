<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import {
    FormError,
    DEFAULT_METADATA,
    DEFAULT_NAMING,
    MODES,
    thresholdOf,
    type Metadata,
    type Mode,
    type Naming,
    type Settings,
  } from '../lib/settings.js';
  import ProfileChoice from './ProfileChoice.svelte';
  import SettingsSection from './SettingsSection.svelte';

  let { settings, save }: { settings: Settings; save: (patch: object) => Promise<void> } = $props();

  const EXPLAINED: readonly ('default' | Mode)[] = ['default', ...MODES];

  // Read once: the page replaces nothing under a form being edited.
  /* svelte-ignore state_referenced_locally */
  const { processing } = settings;
  let naming = $state<Naming | ''>(processing.naming ?? DEFAULT_NAMING);
  let metadata = $state<Metadata | ''>(processing.metadata ?? DEFAULT_METADATA);
  let mode = $state<Mode | ''>(processing.mode ?? '');
  let threshold = $state(processing.threshold === null ? '' : String(processing.threshold));
  let detectPictureSize = $state(processing.detectPictureSize);

  async function submit(): Promise<void> {
    const limit = thresholdOf(threshold);
    if (limit === undefined) {
      throw new FormError(t('web.settings.invalid.threshold'));
    }
    await save({
      processing: {
        // The defaults are not written: a value left at its default writes nothing.
        naming: naming === DEFAULT_NAMING ? null : naming,
        metadata: metadata === DEFAULT_METADATA ? null : metadata,
        mode: mode === '' ? null : mode,
        threshold: limit,
        // On is the default: a box left ticked writes nothing.
        detectPictureSize: detectPictureSize ? null : false,
      },
    });
  }
</script>

<SettingsSection title={t('web.settings.processing.title')} onsubmit={submit}>
  <p class="muted hint">{t('web.settings.processing.intro')}</p>

  <ProfileChoice id="processing" bind:naming bind:metadata examples={settings.namingExamples} />

  <fieldset>
    <legend id="mode-legend">{t('web.settings.processing.mode')}</legend>
    <div class="cards cards-two" role="radiogroup" aria-labelledby="mode-legend">
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

  <div class="field">
    <label class="check">
      <input type="checkbox" bind:checked={detectPictureSize} />
      {t('web.settings.processing.detect-size')}
    </label>
    <span class="muted hint">{t('web.settings.processing.detect-size.hint')}</span>
  </div>
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
</style>
