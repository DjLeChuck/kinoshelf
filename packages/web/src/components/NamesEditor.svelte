<script lang="ts">
  import { ApiError } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import {
    NAME_FIELDS,
    STARTING_NAMES,
    libraryApi,
    type LibraryKind,
    type LibraryNames,
    type NamingPreview,
  } from '../lib/libraries.js';

  let {
    type,
    names = $bindable({ ...STARTING_NAMES }),
    id,
  }: {
    type: LibraryKind;
    names?: Required<LibraryNames>;
    /** Keeps the ids of two forms on one page apart. */
    id: string;
  } = $props();

  /** Says something of the work, in any name. */
  const WORK = ['title', 'year', 'tmdb', 'imdb'] as const;
  /** Says something of the video file: in a folder's name it makes one folder per version. */
  const FILE = ['screenSize', 'source', 'releaseGroup', 'videoCodec', 'audioCodec', 'hdr'] as const;
  const SERIES = ['season', 'episode', 'episodeTitle'] as const;
  /** The variables explained, a group at a time: a series' names add the season and the episode. */
  const groups = $derived.by(() => {
    type Name = (typeof WORK)[number] | (typeof SERIES)[number] | (typeof FILE)[number];
    const found: { group: 'work' | 'series' | 'file'; list: readonly Name[] }[] = [
      { group: 'work', list: WORK },
    ];
    if (type === 'series') {
      found.push({ group: 'series', list: SERIES });
    }
    found.push({ group: 'file', list: FILE });
    return found;
  });
  const fields = $derived(NAME_FIELDS[type]);
  /** What is asked of the server: only the names of this type, as the form holds them. */
  const asked = $derived(
    JSON.stringify(Object.fromEntries(fields.map((field) => [field, names[field].trim()]))),
  );

  let preview = $state<NamingPreview | undefined>(undefined);
  let failure = $state<unknown>(undefined);
  let checking = $state(false);
  let turn = 0;

  // A check after each pause in typing; an answer that comes back after a newer question is dropped.
  $effect(() => {
    const wanted = JSON.parse(asked) as LibraryNames;
    if (Object.values(wanted).some((name) => name === '')) {
      preview = undefined;
      failure = undefined;
      return;
    }
    const mine = ++turn;
    checking = true;
    const timer = setTimeout(() => {
      libraryApi
        .previewNames(wanted)
        .then((report) => {
          if (mine === turn) {
            preview = report;
            failure = undefined;
          }
        })
        .catch((error: unknown) => {
          if (mine === turn) {
            preview = undefined;
            failure = error;
          }
        })
        .finally(() => {
          if (mine === turn) {
            checking = false;
          }
        });
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  });

  /**
   * The server names the field and the variable as the config does (`movieFile`, `title`): the form
   * says them as it shows them, a field by its label and a variable in braces.
   */
  const refusal = $derived.by(() => {
    if (!(failure instanceof ApiError)) {
      return failure === undefined ? '' : messageOf(t, failure);
    }
    const { field, variable } = failure.params;
    const known = (name: unknown): name is (typeof fields)[number] =>
      fields.some((one) => one === name);
    return messageOf(
      t,
      new ApiError(failure.status, failure.code, {
        ...failure.params,
        ...(known(field) && { field: t(`web.libraries.names.${field}`) }),
        ...(typeof variable === 'string' && { variable: '{' + variable + '}' }),
      }),
    );
  });

  const kind = $derived(type === 'movie' ? 'movie' : 'episode');
</script>

<p class="alert alert-warn" role="note">{t('web.libraries.names.note')}</p>

{#each fields as field (field)}
  <div class="field">
    <label for="{id}-{field}">{t(`web.libraries.names.${field}`)}</label>
    <input
      id="{id}-{field}"
      class="input mono"
      autocomplete="off"
      spellcheck="false"
      bind:value={names[field]}
    />
    <span class="muted hint">{t(`web.libraries.names.${field}.hint`)}</span>
  </div>
{/each}

<details class="variables">
  <summary>{t('web.libraries.names.variables')}</summary>
  {#each groups as { group, list } (group)}
    <h4>{t(`web.libraries.names.vars.${group}`)}</h4>
    <dl>
      {#each list as name (name)}
        <dt class="mono">{'{' + name + '}'}</dt>
        <dd>{t(`web.libraries.names.var.${name}`)}</dd>
      {/each}
    </dl>
  {/each}
  <span class="muted hint">{t('web.libraries.names.variables.hint')}</span>
  <span class="muted hint"
    >{t('web.libraries.names.variables.example', { example: '[HDR: {hdr}]' })}</span
  >
</details>

<div class="preview" aria-live="polite">
  <h3>{t('web.libraries.names.preview')}</h3>
  {#if failure}
    <p class="alert alert-danger" role="alert">{refusal}</p>
  {:else if preview}
    {#each ['complete', 'bare'] as const as shape (shape)}
      <div class="sample">
        <span class="muted hint">{t(`web.libraries.names.preview.${shape}`)}</span>
        <code class="mono path">{preview[shape][kind].join(' / ')}</code>
      </div>
    {/each}
    {#each preview.warnings as warning (warning.code)}
      <p class="alert alert-warn" role="note">
        {t(`web.libraries.names.warning.${warning.code}`, warning.params)}
      </p>
    {/each}
  {:else if checking}
    <span class="muted hint">{t('web.libraries.names.preview.checking')}</span>
  {/if}
</div>

<style>
  .variables dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 16px;
    margin: 8px 0;
  }

  .variables dt,
  .variables dd {
    margin: 0;
    font-size: 13px;
  }

  .variables h4 {
    margin: 12px 0 0;
    font-size: 13px;
  }

  .variables summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 13px;
  }

  .preview {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .preview h3 {
    margin: 0;
    font-size: 14px;
  }

  .sample {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .path {
    overflow-wrap: anywhere;
    font-size: 13px;
  }
</style>
