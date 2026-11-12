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
    FormError,
    MODES,
    type Metadata,
    type NamingExample,
    type Naming,
  } from '../lib/settings.js';
  import PathField from './PathField.svelte';
  import ProfileChoice from './ProfileChoice.svelte';

  let {
    library,
    group,
    examples,
    defaults,
    libraries,
    onsaved,
    ondeleted,
    oncancel,
  }: {
    /** `undefined` creates one, of `group`. */
    library?: Library | undefined;
    group: LibraryGroup;
    examples: Readonly<Record<Naming, NamingExample>>;
    /** What "Default" stands for in the profile choice. */
    defaults: { naming: Naming; metadata: Metadata };
    /** Every library, to choose the destinations of an arrival folder among the typed ones. */
    libraries: readonly Library[];
    onsaved: (library: Library) => void;
    ondeleted: () => void;
    oncancel: () => void;
  } = $props();

  // Read once: the page keys this form by library, and nothing replaces it under an edit.
  /* svelte-ignore state_referenced_locally */
  let form = $state(libraryForm(library, group, libraries));
  let busy = $state(false);
  let failure = $state<unknown>(undefined);
  let saved = $state(false);
  let confirming = $state(false);
  /** What is saved, to tell an edit from a form left alone (a new library is always worth saving). */
  let baseline = $state(JSON.stringify($state.snapshot(form)));
  const dirty = $derived(
    library === undefined || JSON.stringify($state.snapshot(form)) !== baseline,
  );

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
      baseline = JSON.stringify($state.snapshot(form));
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
      {#if library}
        <div class="fixed-type">
          <span class="label">{t('web.libraries.type')}</span>
          <span class="chip chip-neutral">{t(`web.libraries.type.${library.type ?? 'movie'}`)}</span
          >
          <span class="muted hint">{t('web.libraries.type.fixed')}</span>
        </div>
      {:else}
        <fieldset>
          <legend>{t('web.libraries.type')}</legend>
          <div class="choices">
            {#each ['movie', 'series'] as const as kind (kind)}
              <label class="check">
                <input type="radio" name="lib-type" value={kind} bind:group={form.type} />
                {t(`web.libraries.type.${kind}`)}
              </label>
            {/each}
          </div>
        </fieldset>
      {/if}
    {/if}

    <!-- One already watched keeps the box, or it could never be turned off. -->
    {#if group === 'in-place' && library?.watch}
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
      <ProfileChoice
        id="lib"
        bind:naming={form.naming}
        bind:metadata={form.metadata}
        {examples}
        {defaults}
        withDefault
      />
    </section>
  {:else}
    <section class="card" aria-labelledby="lib-into">
      <h2 id="lib-into">{t('web.libraries.into')}</h2>
      <div class="pair">
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
      </div>
      <span class="muted hint">{t('web.libraries.into.hint')}</span>
    </section>

    <section class="card" aria-labelledby="lib-mode">
      <h2 id="lib-mode">{t('web.libraries.mode')}</h2>
      <div class="segments" role="radiogroup" aria-labelledby="lib-mode">
        {#each ['', ...MODES] as const as choice (choice)}
          <label class="segment" class:on={form.mode === choice}>
            <input type="radio" name="lib-mode" value={choice} bind:group={form.mode} />
            {choice === ''
              ? t('web.settings.processing.mode.default')
              : t(`web.settings.processing.mode.${choice}`)}
          </label>
        {/each}
      </div>
      <div class="segment-detail" aria-live="polite">
        <span class="muted hint"
          >{t(
            form.mode === ''
              ? 'web.settings.processing.mode.default.help'
              : `web.settings.processing.mode.${form.mode}.help`,
          )}</span
        >
      </div>
      {#if form.mode === 'hardlink'}
        <p class="alert alert-warn" role="note">{t('web.libraries.mode.hardlink.warning')}</p>
      {/if}
    </section>

    <section class="card">
      <label class="check">
        <input type="checkbox" bind:checked={form.watch} />
        {t('web.libraries.watch')}
      </label>
      <span class="muted hint">{t('web.libraries.watch.hint')}</span>
    </section>
  {/if}

  <details class="card advanced">
    <summary>{t('web.libraries.advanced')}</summary>
    <div class="advanced-body">
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
    </div>
  </details>

  {#if failure}
    <p class="alert alert-danger" role="alert">
      {failure instanceof FormError ? failure.message : messageOf(t, failure)}
    </p>
  {/if}
  {#if saved && library}<p class="ok" role="status">{t('web.settings.saved')}</p>{/if}

  <div class="footer">
    {#if confirming && library}
      <div class="confirm" role="alertdialog" aria-label={t('web.libraries.delete')}>
        <p>{t('web.libraries.delete.warning', { name: library.name })}</p>
        <div class="buttons">
          <button
            type="button"
            class="btn danger-solid"
            disabled={busy}
            onclick={() => void remove()}
          >
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
    <div class="bar">
      <div class="left">
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
      <div class="right">
        {#if library && dirty}
          <span class="dirty" role="status">{t('web.libraries.unsaved')}</span>
        {/if}
        <button type="button" class="btn" disabled={busy} onclick={oncancel}>
          {t('web.libraries.close')}
        </button>
        <button type="submit" class="btn btn-primary" disabled={busy || !dirty}>
          {busy
            ? t('web.settings.saving')
            : library
              ? t('web.settings.save')
              : t('web.libraries.create')}
        </button>
      </div>
    </div>
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

  .pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }

  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 24px;
  }

  /* A flex card would keep its gap before the hidden content of a closed <details>. */
  .advanced {
    display: block;
  }

  .advanced-body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 16px;
  }

  .advanced summary {
    /* A 44px line keeps the touch target and the marker; the margin trims the card's padding. */
    line-height: 44px;
    margin: -12px 0;
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

  /* Stays at the bottom of the dialog whatever its scroll; the dialog's padding is 16px. */
  .footer {
    position: sticky;
    bottom: -16px;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0 -16px -16px;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
    background: var(--surface);
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .right {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    margin-left: auto;
  }

  .dirty {
    color: var(--accent-text);
    font-size: 13px;
  }

  .fixed-type {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .fixed-type .label {
    color: var(--muted);
    font-size: 13px;
  }

  .danger {
    color: var(--danger);
    border-color: var(--danger);
  }

  .danger-solid {
    color: var(--bg);
    background: var(--danger);
    border-color: var(--danger);
  }

  /* Reads as a warning, not as another field. */
  .confirm {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 16px;
    border: 1px solid var(--danger);
    border-radius: var(--radius-sm);
    background: var(--danger-bg);
  }

  .confirm p {
    margin: 0;
    color: var(--text);
    font-size: 13px;
  }
</style>
