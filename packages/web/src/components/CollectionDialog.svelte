<script lang="ts">
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import {
    canApply,
    collectionApi,
    draftOf,
    resultNotice,
    setPreview,
    type CollectionDetail,
    type CollectionDraft,
    type CollectionMode,
  } from '../lib/collections.js';

  // One dialog for both cases: a movie's page (`detail`: where it stands, the saga TMDB lists) and
  // the bar's "Set the collection…" (no `detail`: a selection, whose movies may belong to different
  // sagas, so there is no list of parts and no preview, and nothing is chosen beforehand).
  let {
    libraryId,
    items,
    title,
    detail,
    films = items.length,
    nfo = items.length,
    writesNfo = true,
    onclose,
    ondone,
  }: {
    libraryId: string;
    /** The `id`s of the movies the choice is for. */
    items: readonly string[];
    /** The movie, `Matrix (1999)`: the dialog's title for one movie. */
    title?: string;
    /** A single movie's collection; absent for a selection. */
    detail?: CollectionDetail | undefined;
    /** What a selection covers: movies, and NFO (one per version). */
    films?: number;
    nfo?: number;
    /** `false` when the library writes no NFO: the choice only sorts and filters, nothing is written. */
    writesNfo?: boolean;
    onclose: () => void;
    /** The choice was applied: what to tell the user. */
    ondone: (message: string) => void;
  } = $props();

  // The parent mounts this dialog for one opening, so what is read here once is right for its life.
  /* svelte-ignore state_referenced_locally */
  const current = detail ? draftOf(detail) : undefined;
  let dialog: HTMLDialogElement | undefined;
  // What the owner picked: nothing until they touch it.
  let edited = $state<CollectionDraft | undefined>(current);
  const draft = $derived(edited);
  const ready = $derived(canApply(draft, current));
  let working = $state(false);
  let failure = $state<unknown>(undefined);

  $effect(() => {
    dialog?.showModal();
  });

  const multiple = $derived(detail === undefined);
  const options = $derived<
    readonly { mode: CollectionMode; label: string; hint?: string; disabled: boolean }[]
  >([
    multiple
      ? {
          mode: 'tmdb',
          label: t('web.collection.bulk.opt.tmdb'),
          hint: t('web.collection.bulk.opt.tmdb.hint'),
          disabled: false,
        }
      : {
          mode: 'tmdb',
          label: detail?.tmdb
            ? t('web.collection.opt.tmdb', { name: detail.tmdb.name })
            : t('web.collection.opt.tmdb.none'),
          disabled: detail?.tmdb == null,
        },
    {
      mode: 'none',
      label: t('web.collection.opt.none'),
      ...(!multiple && { hint: t('web.collection.opt.none.hint') }),
      disabled: false,
    },
    { mode: 'custom', label: t('web.collection.opt.custom'), disabled: false },
  ]);

  const subtitle = $derived.by(() => {
    if (!detail) {
      return undefined;
    }
    const effective = detail.effective;
    return effective
      ? t('web.collection.dialog.current', {
          name: effective.name,
          source: t(
            effective.custom
              ? 'web.collection.dialog.source.custom'
              : 'web.collection.dialog.source.tmdb',
          ),
        })
      : t('web.collection.dialog.current.none');
  });

  const preview = $derived(draft && detail ? setPreview(draft, detail.tmdb) : null);
  const held = $derived(detail?.parts.filter(({ present }) => present).length ?? 0);

  function choose(mode: CollectionMode): void {
    edited = { mode, name: mode === 'custom' ? (draft?.name ?? '') : '' };
  }

  async function apply(): Promise<void> {
    if (!draft) {
      return;
    }
    working = true;
    failure = undefined;
    try {
      const message = resultNotice(await collectionApi.set(libraryId, items, draft), t);
      ondone(message);
      dialog?.close();
    } catch (error) {
      failure = error;
    } finally {
      working = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="card"
  aria-labelledby="collection-title"
  {onclose}
  oncancel={(event) => {
    // Esc must not close what is being written: the answer would go to nobody.
    if (working) {
      event.preventDefault();
    }
  }}
>
  <header>
    <div>
      <h2 id="collection-title">
        {multiple
          ? t('web.collection.bulk.title', { count: items.length })
          : t('web.collection.dialog.title', { title: title ?? '' })}
      </h2>
      {#if subtitle}<p class="muted">{subtitle}</p>{/if}
    </div>
    <button
      type="button"
      class="close"
      aria-label={t('web.collection.dialog.close')}
      disabled={working}
      onclick={() => dialog?.close()}>×</button
    >
  </header>

  <div class="body">
    <fieldset>
      <legend class="sr-only">{t('web.collection.title')}</legend>
      {#each options as option (option.mode)}
        <label class="opt" class:off={option.disabled}>
          <input
            type="radio"
            name="collection-mode"
            value={option.mode}
            checked={draft?.mode === option.mode}
            disabled={option.disabled || working}
            onchange={() => {
              choose(option.mode);
            }}
          />
          <span>
            {option.label}
            {#if option.hint}<span class="muted hint">{option.hint}</span>{/if}
          </span>
        </label>
      {/each}
    </fieldset>

    {#if draft?.mode === 'custom'}
      <div class="custom">
        <div class="field">
          <label for="collection-name">{t('web.collection.name')}</label>
          <input
            id="collection-name"
            class="input"
            value={draft.name}
            placeholder={t('web.collection.name.placeholder')}
            oninput={(event) => {
              edited = { mode: 'custom', name: event.currentTarget.value };
            }}
          />
        </div>
        {#if detail && detail.customNames.length > 0}
          <div class="names">
            <span class="muted hint">{t('web.collection.existing')}</span>
            {#each detail.customNames as name (name)}
              <button
                type="button"
                class="btn name"
                onclick={() => {
                  edited = { mode: 'custom', name };
                }}>{name}</button
              >
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if detail && draft?.mode === 'tmdb' && detail.parts.length > 0}
      <div class="parts">
        <p class="muted hint">
          {t('web.collection.parts', { held, total: detail.parts.length })}
        </p>
        <ul>
          {#each detail.parts as part (part.id)}
            <li>
              <span class:ok={part.present} aria-hidden="true">{part.present ? '✓' : '○'}</span>
              <span class:muted={!part.present}
                >{part.title}{part.year ? ` (${part.year})` : ''}</span
              >
              <span class="sr-only"
                >: {part.present
                  ? t('web.collection.part.present')
                  : t('web.collection.part.missing')}</span
              >
              {#if !part.present}
                <span class="chip chip-warn">{t('web.collection.part.missing')}</span>
                <a
                  href={`https://www.themoviedb.org/movie/${part.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('web.collection.part.tmdb.label', { title: part.title })}
                  >{t('web.collection.part.tmdb')}</a
                >
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if !writesNfo}
      <p class="muted hint">{t('web.collection.nowrite')}</p>
    {:else}
      {#if detail && draft}
        <div class="preview">
          <span class="muted hint">{t('web.collection.preview')}</span>
          <code>{preview ?? t('web.collection.preview.none')}</code>
        </div>
      {/if}
      <p class="muted hint">
        {multiple ? t('web.collection.bulk.explain', { films, nfo }) : t('web.collection.hint')}
      </p>
    {/if}
    {#if failure}<p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>{/if}
  </div>

  <footer>
    <button type="button" class="btn" disabled={working} onclick={() => dialog?.close()}>
      {t('web.collection.cancel')}
    </button>
    <button
      type="button"
      class="btn btn-primary"
      disabled={!ready || working}
      onclick={() => void apply()}
    >
      {t('web.collection.apply')}
    </button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(560px, 94vw);
    max-height: 86vh;
    color: var(--text);
  }

  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow: hidden;
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 50%);
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  h2 {
    margin: 0;
    font-size: 18px;
  }

  p {
    margin: 0;
  }

  .close {
    flex: none;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: var(--muted);
    font-size: 24px;
    cursor: pointer;
  }

  .close:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
  }

  /* Only the body scrolls: the title and the buttons stay in view however long the saga is. */
  .body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    overflow: auto;
  }

  footer {
    display: flex;
    flex: none;
    justify-content: flex-end;
    gap: 8px;
  }

  fieldset {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .opt {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-height: 44px;
    padding: 10px 0;
    cursor: pointer;
  }

  .opt input {
    flex: none;
    width: 18px;
    height: 18px;
    margin: 1px 0 0;
    accent-color: var(--accent);
  }

  .opt .hint {
    display: block;
  }

  .opt.off {
    color: var(--muted);
    cursor: not-allowed;
  }

  .custom {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-left: 28px;
  }

  .names {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .name {
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 13px;
  }

  .parts {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-height: 28px;
  }

  li > span:first-child {
    width: 16px;
    text-align: center;
    color: var(--muted);
  }

  li > .ok {
    color: var(--ok);
  }

  .preview {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  code {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    font-family: var(--mono);
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .hint {
    font-size: 12px;
  }
</style>
