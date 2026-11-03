<script lang="ts">
  import { api, ApiError } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { t } from '../lib/i18n.svelte.js';
  import {
    folderOf,
    releaseName,
    statusOf,
    toMatchBody,
    validate,
    type Arrival,
    type Candidate,
    type ConflictBody,
    type Preview,
  } from '../lib/arrivals.js';
  import type { MessageKey } from '@kinoshelf/i18n';
  import CandidateList from './CandidateList.svelte';

  let {
    entry,
    siblings = 1,
    ondone,
  }: {
    entry: Arrival;
    /** Files validated together with this one: its release's (1 for a movie or a lone episode). */
    siblings?: number;
    /** The file left the list (transferred or set aside): what to tell the user. */
    ondone: (message: string) => void;
  } = $props();

  // The parent keys this component on the file, so what is read here once is right for its life.
  /* svelte-ignore state_referenced_locally */
  let selected = $state<Candidate | undefined>(entry.candidates[0]);
  let preview = $state<Preview | undefined>(undefined);
  let previewing = $state(false);
  let results = $state<readonly Candidate[] | undefined>(undefined);
  let searching = $state(false);
  /* svelte-ignore state_referenced_locally */
  let query = $state(entry.title ?? '');
  /* svelte-ignore state_referenced_locally */
  let year = $state(entry.year === null ? '' : String(entry.year));
  let kind = $state<'' | 'movie' | 'series'>('');
  let busy = $state(false);
  /* svelte-ignore state_referenced_locally */
  let library = $state(entry.destination.libraryId ?? entry.destinationOptions[0]?.id ?? '');
  let failure = $state<unknown>(undefined);
  let refused = $state<readonly ConflictBody[]>([]);

  const status = $derived(statusOf(entry));
  const name = $derived(label(entry, siblings));
  /** Only a library other than the default one is a choice; the server knows the default. */
  const chosenLibrary = $derived(
    library !== '' && library !== entry.destination.libraryId ? library : undefined,
  );
  const conflicts = $derived(preview?.conflicts ?? []);
  const canValidate = $derived(
    selected !== undefined &&
      !busy &&
      !previewing &&
      preview !== undefined &&
      library !== '' &&
      conflicts.length === 0,
  );

  const reasons = (list: readonly ConflictBody[]): string =>
    list.map((c) => t(`conflict.${c.reason}` as MessageKey)).join(', ');

  // The destination of the chosen candidate. An answer that comes after another choice is stale.
  let latest = 0;
  $effect(() => {
    const candidate = selected;
    const destination = chosenLibrary;
    const ticket = ++latest;
    preview = undefined;
    refused = [];
    if (!candidate) {
      previewing = false;
      return;
    }
    previewing = true;
    api
      .post<Preview>(`/api/entries/${entry.id}/preview`, {
        ...toMatchBody(candidate),
        ...(destination !== undefined && { libraryId: destination }),
      })
      .then((answer) => {
        if (ticket === latest) {
          preview = answer;
        }
      })
      .catch((error: unknown) => {
        if (ticket === latest) {
          failure = error;
        }
      })
      .finally(() => {
        if (ticket === latest) {
          previewing = false;
        }
      });
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
      ...(/^\d{4}$/.test(year.trim()) ? [`year=${year.trim()}`] : []),
      ...(kind !== '' ? [`kind=${kind}`] : []),
    ];
    try {
      results = await api.get<Candidate[]>(`/api/search?${parameters.join('&')}`);
    } catch (error) {
      failure = error;
    } finally {
      searching = false;
    }
  }

  async function confirm(): Promise<void> {
    if (!selected) {
      return;
    }
    busy = true;
    failure = undefined;
    try {
      const outcome = await validate(
        entry,
        {
          candidate: selected,
          libraryId: chosenLibrary,
        },
        api.post,
      );
      if (outcome.status === 'conflict') {
        refused = outcome.conflicts;
      } else {
        ondone(
          outcome.followed > 0
            ? t('web.queue.validated.followed', { name, count: outcome.followed })
            : t('web.queue.validated', { name }),
        );
      }
    } catch (error) {
      failure = error;
    } finally {
      busy = false;
    }
  }

  async function ignore(): Promise<void> {
    busy = true;
    failure = undefined;
    try {
      await api.post(`/api/entries/${entry.id}/ignore`);
      ondone(t('web.queue.ignored', { name }));
    } catch (error) {
      failure = error;
    } finally {
      busy = false;
    }
  }

  /** What the panel calls the file: its release when several files go along, its own name else. */
  function label(arrival: Arrival, count: number): string {
    return count > 1 && !arrival.detached && arrival.release
      ? releaseName(arrival.release)
      : arrival.file;
  }
</script>

<article class="card">
  <header>
    <div>
      <h2 class="mono release">{name}</h2>
      <p class="muted mono folder">{folderOf(entry.path)}</p>
    </div>
    <span
      class="chip chip-{status === 'to-validate'
        ? 'warn'
        : status === 'nothing-found'
          ? 'neutral'
          : 'danger'}"
    >
      {t(`web.queue.status.${status}`)}
    </span>
  </header>

  {#if entry.detached}
    <p class="alert" role="note">
      {t('web.queue.detached', { release: entry.release ? releaseName(entry.release) : '' })}
    </p>
  {/if}
  {#if siblings > 1}
    <p class="alert" role="note">{t('web.queue.release-scope', { count: siblings })}</p>
  {/if}

  <dl class="tags" aria-label={t('web.queue.detected')}>
    <div class="chip chip-neutral">
      {t(
        `web.queue.kind.${entry.kind === 'movie' ? 'movie' : entry.kind === 'series' ? 'series' : 'unknown'}`,
      )}
    </div>
    {#if entry.title}<div class="chip chip-neutral">{entry.title}</div>{/if}
    {#if entry.year}<div class="chip chip-neutral">{entry.year}</div>{/if}
    {#if entry.resolution}<div class="chip chip-neutral">{entry.resolution}</div>{/if}
  </dl>

  {#if entry.error}
    <p class="alert alert-danger" role="alert">
      {t('web.queue.failed')}: {messageOf(t, new ApiError(0, entry.error.code, entry.error.params))}
    </p>
  {/if}

  <section aria-labelledby="candidates-title">
    <h3 id="candidates-title">{t('web.queue.candidates')}</h3>
    {#if entry.candidates.length > 0}
      <CandidateList
        candidates={entry.candidates}
        {selected}
        label={t('web.queue.candidates')}
        onselect={(candidate: Candidate) => {
          selected = candidate;
        }}
      />
    {:else}
      <p class="muted">
        {entry.reason ? `${t(`unrecognized.${entry.reason}` as MessageKey)}. ` : ''}{t(
          'web.queue.no-candidates',
        )}
      </p>
    {/if}
  </section>

  <section aria-labelledby="search-title">
    <h3 id="search-title">{t('web.queue.search.title')}</h3>
    <form class="search" onsubmit={search}>
      <div class="field grow">
        <label for="search-query">{t('web.queue.search.query')}</label>
        <input id="search-query" class="input" type="search" required bind:value={query} />
      </div>
      <div class="field year">
        <label for="search-year">{t('web.queue.search.year')}</label>
        <input
          id="search-year"
          class="input"
          inputmode="numeric"
          pattern="[0-9]{'{4}'}"
          maxlength="4"
          bind:value={year}
        />
      </div>
      <div class="field">
        <label for="search-kind">{t('web.queue.search.kind')}</label>
        <select id="search-kind" class="input" bind:value={kind}>
          <option value="">{t('web.queue.search.kind.any')}</option>
          <option value="movie">{t('web.queue.kind.movie')}</option>
          <option value="series">{t('web.queue.kind.series')}</option>
        </select>
      </div>
      <button type="submit" class="btn" disabled={searching || query.trim() === ''}>
        {searching ? t('web.queue.search.searching') : t('web.queue.search.submit')}
      </button>
    </form>
    {#if results}
      <div class="results" role="status">
        {#if results.length === 0}
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
    {/if}
  </section>

  <section aria-labelledby="destination-title" aria-live="polite">
    <h3 id="destination-title">{t('web.queue.destination')}</h3>
    {#if !selected}
      <p class="muted">{t('web.queue.destination.pick')}</p>
    {:else if previewing}
      <p class="muted">{t('web.queue.destination.loading')}</p>
    {:else if preview}
      {#if preview.destination}<p class="mono">{preview.destination}</p>{/if}
      {#if conflicts.length > 0}
        <p class="alert alert-danger">
          {t('web.queue.conflicts', { reasons: reasons(conflicts) })}
        </p>
      {/if}
    {/if}
    {#if refused.length > 0}
      <p class="alert alert-danger" role="alert">
        {t('web.queue.conflicts', { reasons: reasons(refused) })}
      </p>
    {/if}
  </section>

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {/if}

  {#if entry.destinationOptions.length > 0}
    <section aria-labelledby="library-title">
      <h3 id="library-title">{t('web.queue.library')}</h3>
      <select
        id="arrival-library"
        class="input"
        aria-labelledby="library-title"
        bind:value={library}
      >
        {#each entry.destinationOptions as option (option.id)}
          <option value={option.id}>{option.name}</option>
        {/each}
      </select>
    </section>
  {/if}

  <footer>
    <button
      type="button"
      class="btn btn-primary"
      disabled={!canValidate}
      onclick={() => void confirm()}
    >
      {busy ? t('web.queue.validating') : t('web.queue.validate')}
    </button>
    <button type="button" class="btn" disabled={busy} onclick={() => void ignore()}>
      {t('web.queue.ignore')}
    </button>
  </footer>
</article>

<style>
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .release {
    font-size: 14px;
    font-weight: 600;
  }

  .folder {
    margin-top: 2px;
    font-size: 11.5px;
  }

  h3 {
    margin-bottom: 8px;
    font-size: 13px;
    color: var(--muted);
    font-weight: 600;
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
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
    margin-top: 12px;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
</style>
