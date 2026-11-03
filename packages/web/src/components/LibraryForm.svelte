<script lang="ts">
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import {
    THRESHOLD_MAX,
    THRESHOLD_MIN,
    libraryApi,
    libraryBody,
    libraryForm,
    type Library,
    type LibraryGroup,
  } from '../lib/libraries.js';
  import {
    CUSTOM_PROFILE,
    FormError,
    MODES,
    profileHelp,
    profileName,
    type ShippedProfile,
  } from '../lib/settings.js';
  import PathField from './PathField.svelte';

  let {
    library,
    group,
    profiles,
    libraries,
    onsaved,
    ondeleted,
    oncancel,
  }: {
    /** `undefined` creates one, of `group`. */
    library?: Library | undefined;
    group: LibraryGroup;
    profiles: readonly ShippedProfile[];
    /** Every library, to choose the destinations of an arrival folder among the typed ones. */
    libraries: readonly Library[];
    onsaved: (library: Library) => void;
    ondeleted: () => void;
    oncancel: () => void;
  } = $props();

  // Read once: the page keys this form by library, and nothing replaces it under an edit.
  /* svelte-ignore state_referenced_locally */
  let form = $state(libraryForm(library, profiles, group, libraries));
  let busy = $state(false);
  let failure = $state<unknown>(undefined);
  let saved = $state(false);
  let confirming = $state(false);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    failure = undefined;
    saved = false;
    try {
      const body = libraryBody(form, library === undefined);
      if ('invalid' in body) {
        throw new FormError(
          t(
            body.invalid === 'threshold'
              ? 'web.settings.invalid.threshold'
              : `web.libraries.invalid.${body.invalid}`,
          ),
        );
      }
      const result = library
        ? await libraryApi.update(library.id, body)
        : await libraryApi.create(body);
      saved = true;
      onsaved(result);
    } catch (error) {
      failure = error;
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    if (!library) {
      return;
    }
    busy = true;
    failure = undefined;
    try {
      await libraryApi.remove(library.id);
      ondeleted();
    } catch (error) {
      failure = error;
      confirming = false;
    } finally {
      busy = false;
    }
  }

  const typed = $derived((kind: 'movie' | 'series') =>
    libraries.filter((one) => one.type === kind),
  );

  const profileChoices = $derived([
    {
      id: '',
      name: t('web.libraries.profile.default'),
      help: t('web.libraries.profile.default.help'),
    },
    ...profiles.map((profile) => ({
      id: profile.id,
      name: profileName(profile, t),
      help: profileHelp(profile.id, t),
      example: profile.example.movie,
    })),
    {
      id: CUSTOM_PROFILE,
      name: t('web.settings.processing.profile.custom'),
      help: t('web.settings.processing.profile.path.hint'),
    },
  ]);
</script>

<form onsubmit={submit} class="form">
  <section class="card" aria-labelledby="lib-folders">
    <h2 id="lib-folders">
      {library
        ? library.name
        : t(group === 'arrival' ? 'web.libraries.new.arrival' : 'web.libraries.new.in-place')}
    </h2>
    <p class="muted hint">
      {t(group === 'arrival' ? 'web.libraries.arrival.hint' : 'web.libraries.in-place.hint')}
    </p>
    <div class="field">
      <label for="lib-name">{t('web.libraries.name')}</label>
      <input id="lib-name" class="input" bind:value={form.name} />
      <span class="muted hint">{t('web.libraries.name.hint')}</span>
    </div>
    <div class="field">
      <label for="lib-source">{t('web.libraries.source')}</label>
      <PathField id="lib-source" placeholder="/" bind:value={form.source} />
      <span class="muted hint">
        {t(group === 'arrival' ? 'web.libraries.source.arrival.hint' : 'web.libraries.source.hint')}
      </span>
    </div>

    {#if group === 'in-place'}
      <fieldset>
        <legend>{t('web.libraries.type')}</legend>
        <div class="choices">
          {#each ['movie', 'series'] as const as kind (kind)}
            <label class="check">
              <input
                type="radio"
                name="lib-type"
                value={kind}
                disabled={library !== undefined}
                bind:group={form.type}
              />
              {t(`web.libraries.type.${kind}`)}
            </label>
          {/each}
        </div>
        {#if library}<span class="muted hint">{t('web.libraries.type.fixed')}</span>{/if}
      </fieldset>
    {:else}
      <fieldset>
        <legend>{t('web.libraries.into')}</legend>
        {#each ['movie', 'series'] as const as kind (kind)}
          <div class="field">
            <label for={`lib-into-${kind}`}>{t(`web.libraries.into.${kind}`)}</label>
            <select id={`lib-into-${kind}`} class="input" bind:value={form.into[kind]}>
              <option value="" disabled>{t('web.libraries.into.choose')}</option>
              {#each typed(kind) as option (option.id)}
                <option value={option.id}>{option.name}</option>
              {/each}
            </select>
          </div>
        {/each}
        <span class="muted hint">{t('web.libraries.into.hint')}</span>
      </fieldset>
    {/if}

    <!-- Only an arrival folder holds finished downloads; a library organized in place is written to.
         One already watched keeps the box, or it could never be turned off. -->
    {#if group === 'arrival' || library?.watch}
      <label class="check">
        <input type="checkbox" bind:checked={form.watch} />
        {t('web.libraries.watch')}
      </label>
      <span class="muted hint">{t('web.libraries.watch.hint')}</span>
    {/if}
  </section>

  {#if group === 'in-place'}
    <section class="card" aria-labelledby="lib-profile">
      <h2 id="lib-profile">{t('web.libraries.profile')}</h2>
      <div class="cards" role="radiogroup" aria-labelledby="lib-profile">
        {#each profileChoices as choice (choice.id)}
          <label class="option" class:on={form.profile.choice === choice.id}>
            <input
              type="radio"
              name="lib-profile"
              value={choice.id}
              bind:group={form.profile.choice}
            />
            <span class="option-name">{choice.name}</span>
            {#if choice.help}<span class="muted hint">{choice.help}</span>{/if}
            {#if 'example' in choice}<code class="example">{choice.example}</code>{/if}
          </label>
        {/each}
      </div>
      {#if form.profile.choice === CUSTOM_PROFILE}
        <div class="field">
          <label for="lib-profile-path">{t('web.settings.processing.profile.path')}</label>
          <PathField
            id="lib-profile-path"
            kind="file"
            placeholder="/config/my-profile.yaml"
            bind:value={form.profile.path}
          />
        </div>
      {/if}
    </section>
  {:else}
    <section class="card" aria-labelledby="lib-mode">
      <h2 id="lib-mode">{t('web.libraries.mode')}</h2>
      <div class="cards cards-two" role="radiogroup" aria-labelledby="lib-mode">
        {#each ['', ...MODES] as const as choice (choice)}
          <label class="option" class:on={form.mode === choice}>
            <input type="radio" name="lib-mode" value={choice} bind:group={form.mode} />
            <span class="option-name"
              >{choice === ''
                ? t('web.settings.processing.mode.default')
                : t(`web.settings.processing.mode.${choice}`)}</span
            >
            <span class="muted hint"
              >{t(
                choice === ''
                  ? 'web.settings.processing.mode.default.help'
                  : `web.settings.processing.mode.${choice}.help`,
              )}</span
            >
          </label>
        {/each}
      </div>
      {#if form.mode === 'hardlink'}
        <p class="alert" role="note">{t('web.libraries.mode.hardlink.warning')}</p>
      {/if}
    </section>
  {/if}

  <details class="card advanced">
    <summary>{t('web.libraries.advanced')}</summary>
    <h2>{t('web.libraries.threshold')}</h2>
    <label class="check">
      <input type="checkbox" bind:checked={form.defaultThreshold} />
      {t('web.libraries.threshold.default')}
    </label>
    <div class="slider">
      <label class="sr-only" for="lib-threshold">{t('web.libraries.threshold')}</label>
      <input
        id="lib-threshold"
        type="range"
        min={THRESHOLD_MIN}
        max={THRESHOLD_MAX}
        step="1"
        disabled={form.defaultThreshold}
        bind:value={form.threshold}
      />
      <output class="mono" for="lib-threshold"
        >{form.defaultThreshold ? '—' : form.threshold}</output
      >
    </div>
    <span class="muted hint">{t('web.libraries.threshold.hint')}</span>
  </details>

  {#if failure}
    <p class="alert alert-danger" role="alert">
      {failure instanceof FormError ? failure.message : messageOf(t, failure)}
    </p>
  {/if}
  {#if saved && library}<p class="ok" role="status">{t('web.settings.saved')}</p>{/if}

  {#if confirming && library}
    <div class="alert confirm" role="alertdialog" aria-label={t('web.libraries.delete')}>
      <p>{t('web.libraries.delete.warning', { name: library.name })}</p>
      <div class="buttons">
        <button type="button" class="btn btn-primary" disabled={busy} onclick={() => void remove()}>
          {t('web.libraries.delete.confirm')}
        </button>
        <button
          type="button"
          class="btn"
          disabled={busy}
          onclick={() => {
            confirming = false;
          }}>{t('web.libraries.delete.cancel')}</button
        >
      </div>
    </div>
  {/if}

  <div class="buttons">
    <button type="submit" class="btn btn-primary" disabled={busy}>
      {busy
        ? t('web.settings.saving')
        : library
          ? t('web.settings.save')
          : t('web.libraries.create')}
    </button>
    <button type="button" class="btn" disabled={busy} onclick={oncancel}>
      {t('web.libraries.close')}
    </button>
    {#if library && !confirming}
      <button
        type="button"
        class="btn danger"
        onclick={() => {
          confirming = true;
        }}>{t('web.libraries.delete')}</button
      >
    {/if}
  </div>
</form>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  h2 {
    font-size: 16px;
  }

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

  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 24px;
  }

  /* The radio stays in the page for the keyboard and screen readers; the card is what is seen. */
  .example {
    font-size: 11.5px;
    overflow-wrap: anywhere;
  }

  .advanced summary {
    min-height: 44px;
    cursor: pointer;
  }

  .slider {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .slider input {
    flex: 1 1 auto;
    min-height: 44px;
    accent-color: var(--accent);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .danger {
    color: var(--danger);
    border-color: var(--danger);
  }

  .confirm {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .confirm p {
    margin: 0;
  }
</style>
