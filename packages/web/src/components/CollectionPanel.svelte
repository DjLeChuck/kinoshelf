<script lang="ts">
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import {
    collectionApi,
    draftOf,
    isChanged,
    isValid,
    resultNotice,
    setPreview,
    type CollectionDetail,
    type CollectionDraft,
    type CollectionMode,
  } from '../lib/collections.js';

  let {
    libraryId,
    itemId,
    detail,
    ondone,
  }: {
    libraryId: string;
    itemId: string;
    detail: CollectionDetail;
    /** The choice was applied and the NFO written again: what to tell the user. */
    ondone: (message: string) => void;
  } = $props();

  const current = $derived(draftOf(detail));
  // Where the owner is picking: nothing until they touch it, then it stays theirs until applied.
  let edited = $state<CollectionDraft | undefined>(undefined);
  const draft = $derived(edited ?? current);
  const changed = $derived(isChanged(draft, current));
  const canApply = $derived(changed && isValid(draft));
  let working = $state(false);
  let failure = $state<unknown>(undefined);

  const options = $derived<readonly { mode: CollectionMode; label: string; disabled: boolean }[]>([
    {
      mode: 'tmdb',
      label: detail.tmdb
        ? t('web.collection.opt.tmdb', { name: detail.tmdb.name })
        : t('web.collection.opt.tmdb.none'),
      disabled: detail.tmdb === null,
    },
    { mode: 'none', label: t('web.collection.opt.none'), disabled: false },
    { mode: 'custom', label: t('web.collection.opt.custom'), disabled: false },
  ]);

  const preview = $derived(setPreview(draft, detail.tmdb));
  const held = $derived(detail.parts.filter(({ present }) => present).length);

  function choose(mode: CollectionMode): void {
    edited = { mode, name: mode === 'custom' ? draft.name : '' };
  }

  async function apply(): Promise<void> {
    working = true;
    failure = undefined;
    try {
      const result = await collectionApi.set(libraryId, [itemId], draft);
      edited = undefined;
      ondone(resultNotice(result, t));
    } catch (error) {
      failure = error;
    } finally {
      working = false;
    }
  }
</script>

<section aria-labelledby="collection-title">
  <h3 id="collection-title">{t('web.collection.title')}</h3>

  <fieldset>
    <legend class="sr-only">{t('web.collection.title')}</legend>
    {#each options as option (option.mode)}
      <label class="opt" class:off={option.disabled}>
        <input
          type="radio"
          name="collection-mode"
          value={option.mode}
          checked={draft.mode === option.mode}
          disabled={option.disabled}
          onchange={() => {
            choose(option.mode);
          }}
        />
        {option.label}
      </label>
    {/each}
  </fieldset>

  {#if draft.mode === 'custom'}
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
      {#if detail.customNames.length > 0}
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

  {#if draft.mode === 'tmdb' && detail.parts.length > 0}
    <div class="parts">
      <p class="muted hint">
        {t('web.collection.parts', { held, total: detail.parts.length })}
      </p>
      <ul>
        {#each detail.parts as part (part.id)}
          <li>
            <span class:ok={part.present} aria-hidden="true">{part.present ? '✓' : '○'}</span>
            <span class:muted={!part.present}>{part.title}{part.year ? ` (${part.year})` : ''}</span
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

  <div class="preview">
    <span class="muted hint">{t('web.collection.preview')}</span>
    <code>{preview ?? t('web.collection.preview.none')}</code>
  </div>

  <div class="actions">
    <button
      type="button"
      class="btn btn-primary"
      disabled={!canApply || working}
      onclick={() => void apply()}
    >
      {t('web.collection.apply')}
    </button>
    {#if changed}
      <button
        type="button"
        class="btn"
        onclick={() => {
          edited = undefined;
          failure = undefined;
        }}
      >
        {t('web.collection.cancel')}
      </button>
    {/if}
  </div>
  {#if failure}<p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>{/if}
  <p class="muted hint">{t('web.collection.hint')}</p>
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }

  h3 {
    color: var(--muted);
    font-size: 13px;
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
    align-items: center;
    gap: 10px;
    min-height: 44px;
    cursor: pointer;
  }

  .opt input {
    width: 18px;
    height: 18px;
    margin: 0;
    accent-color: var(--accent);
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

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .hint {
    font-size: 12px;
  }

  p {
    margin: 0;
  }
</style>
