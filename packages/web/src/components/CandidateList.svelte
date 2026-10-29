<script lang="ts">
  import { t } from '../lib/i18n.svelte.js';
  import { sameCandidate, type Candidate } from '../lib/queue.js';
  import Poster from './Poster.svelte';

  let {
    candidates,
    selected,
    label,
    onselect,
  }: {
    candidates: readonly Candidate[];
    selected: Candidate | undefined;
    label: string;
    onselect: (candidate: Candidate) => void;
  } = $props();

  // One group of radios per list: two lists on a page must not share their selection.
  const name = `candidates-${Math.random().toString(36).slice(2)}`;
</script>

<ul role="radiogroup" aria-label={label}>
  {#each candidates as candidate (`${candidate.kind}-${candidate.id.id}`)}
    <li>
      <label class:checked={selected !== undefined && sameCandidate(candidate, selected)}>
        <input
          type="radio"
          {name}
          checked={selected !== undefined && sameCandidate(candidate, selected)}
          onchange={() => {
            onselect(candidate);
          }}
        />
        <Poster path={candidate.posterPath} />
        <span class="text">
          <strong>{candidate.title}{candidate.year ? ` (${candidate.year})` : ''}</strong>
          <span class="muted">
            {t(`web.queue.kind.${candidate.kind}`)}
            {#if candidate.originalTitle !== candidate.title}· {candidate.originalTitle}{/if}
          </span>
        </span>
        <!-- Inside the label, a link does not select the card: it only opens the page. -->
        <a
          class="tmdb"
          href={`https://www.themoviedb.org/${candidate.kind === 'movie' ? 'movie' : 'tv'}/${candidate.id.id}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('web.queue.tmdb-link')}
          title={t('web.queue.tmdb-link')}>TMDB ↗</a
        >
        {#if candidate.score !== undefined}
          <span class="chip chip-neutral">{t('web.queue.score', { score: candidate.score })}</span>
        {/if}
      </label>
    </li>
  {/each}
</ul>

<style>
  ul {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  label {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  label:hover {
    background: var(--surface-2);
  }

  label.checked {
    border-color: var(--accent);
    background: var(--warn-bg);
  }

  /* The radio stays in the page for keyboards and screen readers; the card is the target. */
  input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .tmdb {
    font-size: 0.85em;
    white-space: nowrap;
  }

  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
</style>
