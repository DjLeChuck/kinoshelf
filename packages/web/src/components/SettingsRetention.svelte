<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import {
    DEFAULT_BACKUP_KEEP,
    DEFAULT_REPLACED_RETENTION_DAYS,
    FormError,
    type Settings,
  } from '../lib/settings.js';
  import SettingsSection from './SettingsSection.svelte';

  let { settings, save }: { settings: Settings; save: (patch: object) => Promise<void> } = $props();

  // Read once: the page replaces nothing under a form being edited.
  /* svelte-ignore state_referenced_locally */
  const { retention } = settings;
  let backupKeep = $state(String(retention.backupKeep));
  let replacedDays = $state(String(retention.replacedRetentionDays));

  const wholeNumber = (text: string, least: number): number | undefined => {
    const value = Number(text.trim());
    return text.trim() !== '' && Number.isInteger(value) && value >= least ? value : undefined;
  };

  async function submit(): Promise<void> {
    const keep = wholeNumber(backupKeep, 1);
    const days = wholeNumber(replacedDays, 0);
    if (keep === undefined || days === undefined) {
      throw new FormError(t('web.settings.invalid.retention'));
    }
    await save({
      retention: {
        // A value left at its default writes nothing.
        backupKeep: keep === DEFAULT_BACKUP_KEEP ? null : keep,
        replacedRetentionDays: days === DEFAULT_REPLACED_RETENTION_DAYS ? null : days,
      },
    });
  }
</script>

<SettingsSection title={t('web.settings.retention.title')} onsubmit={submit}>
  <p class="muted hint">{t('web.settings.retention.intro')}</p>

  <div class="field">
    <label for="backup-keep">{t('web.settings.retention.backups')}</label>
    <input id="backup-keep" class="input" inputmode="numeric" bind:value={backupKeep} />
    <span class="muted hint">{t('web.settings.retention.backups.hint')}</span>
  </div>

  <div class="field">
    <label for="replaced-days">{t('web.settings.retention.replaced')}</label>
    <input id="replaced-days" class="input" inputmode="numeric" bind:value={replacedDays} />
    <span class="muted hint">{t('web.settings.retention.replaced.hint')}</span>
  </div>
</SettingsSection>
