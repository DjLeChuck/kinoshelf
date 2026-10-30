<script lang="ts">
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import {
    THRESHOLD_MAX,
    THRESHOLD_MIN,
    libraryApi,
    libraryBody,
    libraryForm,
    scanPath,
    type Library,
    type LibraryForm,
  } from '../lib/libraries.js';
  import { router } from '../lib/router.svelte.js';
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
    profiles,
    onsaved,
    ondeleted,
    ondraft,
  }: {
    /** `undefined` creates one. */
    library?: Library;
    profiles: readonly ShippedProfile[];
    onsaved: (library: Library) => void;
    ondeleted: () => void;
    /** Told of every change, so the page can show the library as it is being filled in. */
    ondraft?: (form: LibraryForm) => void;
  } = $props();

  // Read once: the page keys this form by library, and nothing replaces it under an edit.
  /* svelte-ignore state_referenced_locally */
  let form = $state(libraryForm(library, profiles));
  $effect(() => ondraft?.($state.snapshot(form)));
  let busy = $state(false);
  let failure = $state<unknown>(undefined);
  let saved = $state(false);
  let confirming = $state(false);
  let scanning = $state(false);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    failure = undefined;
    saved = false;
    try {
      const body = libraryBody(form, library === undefined);
      if ('invalid' in body) {
        throw new FormError(t(`web.libraries.invalid.${body.invalid}`));
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

  async function scan(): Promise<void> {
    if (!library) {
      return;
    }
    scanning = true;
    failure = undefined;
    try {
      const job = await libraryApi.scan(library.id);
      router.navigate(scanPath(library.id, job.id));
    } catch (error) {
      failure = error;
    } finally {
      scanning = false;
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
  <div class="head">
    <div>
      <span class="eyebrow muted">{t('web.libraries.eyebrow')}</span>
      <h1>{library ? library.name : t('web.libraries.new.title')}</h1>
    </div>
    {#if library}
      <button type="button" class="btn" disabled={scanning} onclick={() => void scan()}>
        {scanning ? t('web.libraries.scan.starting') : t('web.libraries.scan')}
      </button>
    {/if}
  </div>

  <section class="card" aria-labelledby="lib-folders">
    <h2 id="lib-folders">{t('web.libraries.folders')}</h2>
    <div class="field">
      <label for="lib-name">{t('web.libraries.name')}</label>
      <input id="lib-name" class="input" bind:value={form.name} />
      <span class="muted hint">{t('web.libraries.name.hint')}</span>
    </div>
    <div class="field">
      <label for="lib-source">{t('web.libraries.source')}</label>
      <PathField id="lib-source" placeholder="/" bind:value={form.source} />
      <span class="muted hint">{t('web.libraries.source.hint')}</span>
    </div>

    <fieldset>
      <legend>{t('web.libraries.destination')}</legend>
      <div class="choices">
        <label class="check">
          <input
            type="radio"
            name="lib-destination"
            value={false}
            bind:group={form.destination.separate}
          />
          {t('web.settings.processing.destination.single')}
        </label>
        <label class="check">
          <input
            type="radio"
            name="lib-destination"
            value={true}
            bind:group={form.destination.separate}
          />
          {t('web.settings.processing.destination.separate')}
        </label>
      </div>
      {#if form.destination.separate}
        <div class="field">
          <label for="lib-dest-movies">{t('web.settings.processing.destination.movies')}</label>
          <PathField id="lib-dest-movies" bind:value={form.destination.movies} />
        </div>
        <div class="field">
          <label for="lib-dest-series">{t('web.settings.processing.destination.series')}</label>
          <PathField id="lib-dest-series" bind:value={form.destination.series} />
        </div>
      {:else}
        <div class="field">
          <label class="sr-only" for="lib-dest-single">{t('web.libraries.destination')}</label>
          <PathField id="lib-dest-single" bind:value={form.destination.single} />
        </div>
      {/if}
      <span class="muted hint">{t('web.libraries.destination.hint')}</span>
    </fieldset>

    <label class="check">
      <input type="checkbox" bind:checked={form.watch} />
      {t('web.libraries.watch')}
    </label>
    <span class="muted hint">{t('web.libraries.watch.hint')}</span>
  </section>

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

  <section class="card" aria-labelledby="lib-mode">
    <h2 id="lib-mode">{t('web.libraries.mode')}</h2>
    <div class="cards modes" role="radiogroup" aria-labelledby="lib-mode">
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

  <section class="card" aria-labelledby="lib-threshold-title">
    <h2 id="lib-threshold-title">{t('web.libraries.threshold')}</h2>
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
  </section>

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

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
  }

  .eyebrow {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  h1 {
    font-size: 22px;
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

  .hint {
    font-size: 12px;
  }

  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 24px;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px;
  }

  /* Four cards: two by two rather than three and one. */
  .modes {
    grid-template-columns: repeat(2, 1fr);
  }

  @media (max-width: 560px) {
    .modes {
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

  .example {
    font-size: 11.5px;
    overflow-wrap: anywhere;
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

  .ok {
    color: var(--ok);
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
