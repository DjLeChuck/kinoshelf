<script lang="ts">
  import { api } from '../lib/api.js';
  import { toMatchBody, type Candidate } from '../lib/arrivals.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import { libraryApi, type LibraryKind } from '../lib/libraries.js';
  import CandidateList from './CandidateList.svelte';

  let {
    libraryId,
    path,
    name,
    kind,
    year,
    ondone,
  }: {
    libraryId: string;
    /** The folder to read again; none (or not yet known) leaves the button off. */
    path: string | undefined;
    /** The title the work has now: where the search starts, and what the notice calls it. */
    name: string;
    /** The kind of the library: only a work of that kind can replace this one. */
    kind: LibraryKind;
    year?: number | null | undefined;
    /** The analysis was queued: what to tell the user. */
    ondone: (message: string) => void;
  } = $props();

  let dialog = $state<HTMLDialogElement | undefined>(undefined);
  let open = $state(false);
  // The dialog is mounted once and lives with its panel, which the parent keys on the work: what is
  // read here is right for its life.
  /* svelte-ignore state_referenced_locally */
  let query = $state(name);
  /* svelte-ignore state_referenced_locally */
  let when = $state(year ? String(year) : '');
  let results = $state<readonly Candidate[] | undefined>(undefined);
  let selected = $state<Candidate | undefined>(undefined);
  let searching = $state(false);
  let starting = $state(false);
  let failure = $state<unknown>(undefined);

  $effect(() => {
    if (open) {
      dialog?.showModal();
    }
  });

  async function search(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const text = query.trim();
    if (text === '') {
      return;
    }
    searching = true;
    failure = undefined;
    const parameters = [
      `query=${encodeURIComponent(text)}`,
      ...(/^\d{4}$/.test(when.trim()) ? [`year=${when.trim()}`] : []),
      `kind=${kind}`,
    ];
    try {
      results = await api.get<Candidate[]>(`/api/search?${parameters.join('&')}`);
      selected = undefined;
    } catch (error) {
      failure = error;
    } finally {
      searching = false;
    }
  }

  async function confirm(): Promise<void> {
    if (path === undefined || !selected) {
      return;
    }
    // Read now: the panel may show another work by the time the answer comes.
    const label = name;
    starting = true;
    failure = undefined;
    try {
      await libraryApi.rescan(libraryId, path, toMatchBody(selected));
      dialog?.close();
      ondone(t('web.library.rematch.started', { name: label }));
    } catch (error) {
      failure = error;
    } finally {
      starting = false;
    }
  }
</script>

{#if path !== undefined}
  <button
    type="button"
    class="btn"
    title={t('web.library.rematch.hint')}
    onclick={() => {
      open = true;
    }}>{t('web.library.rematch')}</button
  >
  {#if open}
    <dialog
      bind:this={dialog}
      class="card"
      aria-labelledby="rematch-title"
      onclose={() => {
        open = false;
      }}
      oncancel={(event) => {
        if (starting) {
          event.preventDefault();
        }
      }}
    >
      <h2 id="rematch-title">{t('web.library.rematch.title', { name })}</h2>
      <p class="muted">{t('web.library.rematch.explain')}</p>
      <form class="search" onsubmit={search}>
        <div class="field grow">
          <label for="rematch-query">{t('web.queue.search.query')}</label>
          <input id="rematch-query" class="input" type="search" required bind:value={query} />
        </div>
        <div class="field year">
          <label for="rematch-year">{t('web.queue.search.year')}</label>
          <input
            id="rematch-year"
            class="input"
            inputmode="numeric"
            pattern="[0-9]{'{4}'}"
            maxlength="4"
            bind:value={when}
          />
        </div>
        <button type="submit" class="btn" disabled={searching || query.trim() === ''}>
          {searching ? t('web.queue.search.searching') : t('web.queue.search.submit')}
        </button>
      </form>
      <div class="results" role="status">
        {#if results === undefined}
          <!-- Nothing yet: the search is the first step. -->
        {:else if results.length === 0}
          <p class="muted">{t('web.queue.search.none')}</p>
        {:else}
          <CandidateList
            candidates={results}
            {selected}
            label={t('web.queue.search.results')}
            onselect={(candidate: Candidate) => {
              selected = candidate;
            }}
          />
        {/if}
      </div>
      {#if failure !== undefined}
        <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
      {/if}
      <div class="actions">
        <button type="button" class="btn" disabled={starting} onclick={() => dialog?.close()}>
          {t('web.library.run.cancel')}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          disabled={starting || !selected}
          onclick={() => void confirm()}
        >
          {t('web.library.rematch.confirm')}
        </button>
      </div>
    </dialog>
  {/if}
{/if}

<style>
  dialog {
    width: min(640px, 94vw);
    max-height: 86vh;
    color: var(--text);
  }

  /* Only the results scroll: the title, the search and the buttons stay in view. */
  dialog[open] {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 50%);
  }

  h2 {
    margin: 0 0 8px;
    font-size: 18px;
  }

  p {
    margin: 0 0 8px;
  }

  .search {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px;
  }

  .grow {
    flex: 1 1 200px;
  }

  .year {
    width: 90px;
  }

  .results {
    flex: 1 1 auto;
    min-height: 0;
    margin-top: 12px;
    overflow: auto;
  }

  .actions {
    flex: none;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
