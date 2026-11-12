<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { COLLECTION_FILTERS, type CollectionFilter } from '../lib/collections.js';
  import type { Counts, ShowFilter } from '../lib/library-items.js';

  let {
    query,
    oninput,
    states,
    counts,
    chosen,
    multi,
    collection,
    collectionCounts,
    badge,
    onstate,
    onmulti,
    oncollection,
    onreset,
  }: {
    /** The search box. */
    query: string;
    oninput: (value: string) => void;
    /** The states of the library, in the order the panel lists them. */
    states: readonly ShowFilter[];
    counts: Counts;
    /** The state chosen, if any. */
    chosen: ShowFilter | undefined;
    multi: boolean;
    collection: CollectionFilter | undefined;
    /** Movies per collection filter; `undefined`: this library has no collections to filter by. */
    collectionCounts: Readonly<Record<'all' | 'in' | 'out' | 'incomplete', number>> | undefined;
    /** How many filters are on (the state, the versions, the collection). */
    badge: number;
    onstate: (next: ShowFilter | undefined) => void;
    onmulti: (next: boolean) => void;
    oncollection: (next: CollectionFilter | undefined) => void;
    onreset: () => void;
  } = $props();

  const panelId = $props.id();
  let open = $state(false);
  let toolbar = $state<HTMLElement | undefined>(undefined);
  let trigger = $state<HTMLButtonElement | undefined>(undefined);

  async function close(refocus: boolean): Promise<void> {
    open = false;
    if (refocus) {
      await tick();
      trigger?.focus();
    }
  }

  // Not a modal: the page behind stays usable, and a click anywhere else puts the panel away.
  function away(event: PointerEvent): void {
    if (open && event.target instanceof Node && !toolbar?.contains(event.target)) {
      void close(false);
    }
  }

  function key(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      void close(true);
    }
  }

  const COLLECTION_OPTIONS = [undefined, ...COLLECTION_FILTERS] as const;
</script>

<svelte:window onpointerdown={away} onkeydown={key} />

<div class="toolbar" bind:this={toolbar}>
  <div class="search">
    <label class="sr-only" for="{panelId}-search">{t('web.library.search')}</label>
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg
    >
    <input
      id="{panelId}-search"
      class="input"
      type="search"
      placeholder={t('web.library.search')}
      value={query}
      oninput={(event) => {
        oninput(event.currentTarget.value);
      }}
    />
  </div>

  <button
    type="button"
    class="btn trigger"
    class:on={open || badge > 0}
    bind:this={trigger}
    aria-expanded={open}
    aria-controls={panelId}
    aria-label={badge > 0
      ? `${t('web.library.filters')}, ${t('web.library.filters.count', { count: badge })}`
      : undefined}
    onclick={() => {
      open = !open;
    }}
  >
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg
    >
    {t('web.library.filters')}
    {#if badge > 0}<span class="badge" aria-hidden="true">{badge}</span>{/if}
  </button>

  {#if open}
    <div id={panelId} class="panel" role="group" aria-label={t('web.library.filters')}>
      <section>
        <h3>{t('web.library.filters.state')}</h3>
        {#each states as option (option)}
          {@const active = chosen === option}
          {@const empty = counts[option] === 0 && !active}
          <button
            type="button"
            class="row"
            aria-pressed={active}
            disabled={empty}
            onclick={() => {
              onstate(active ? undefined : option);
            }}
          >
            <span>{t(`web.library.filter.${option}`)}</span>
            <span class="count" class:todo={counts[option] > 0}>{counts[option]}</span>
          </button>
        {/each}
      </section>

      <section>
        <h3>{t('web.library.filters.traits')}</h3>
        <button
          type="button"
          class="row"
          aria-pressed={multi}
          onclick={() => {
            onmulti(!multi);
          }}
        >
          <span>{t('web.library.filter.multi-version')}</span>
          <span class="count">{counts['multi-version']}</span>
        </button>
        {#if collectionCounts}
          <fieldset>
            <legend>{t('web.collection.filter.label')}</legend>
            {#each COLLECTION_OPTIONS as option (option ?? 'all')}
              <label class="row">
                <span class="choice">
                  <input
                    type="radio"
                    name="{panelId}-collection"
                    checked={collection === option}
                    onchange={() => {
                      oncollection(option);
                    }}
                  />
                  {t(`web.collection.filter.${option ?? 'all'}`)}
                </span>
                <span class="count">{collectionCounts[option ?? 'all']}</span>
              </label>
            {/each}
          </fieldset>
        {/if}
      </section>

      <footer>
        <button type="button" class="btn quiet" onclick={onreset}>
          {t('web.library.filters.reset')}
        </button>
        <button
          type="button"
          class="btn"
          onclick={() => {
            void close(true);
          }}
        >
          {t('web.library.filters.close')}
        </button>
      </footer>
    </div>
  {/if}
</div>

<style>
  /* The panel hangs from the whole bar, not from the button: on a phone the button sits on a second
     line, and a panel pinned to it would run off the screen's edge. */
  .toolbar {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 8px;
  }

  .search {
    position: relative;
    flex: 1 1 320px;
    min-width: 0;
  }

  .search svg {
    position: absolute;
    top: 13px;
    left: 14px;
    color: var(--muted);
    pointer-events: none;
  }

  .search .input {
    width: 100%;
    box-sizing: border-box;
    padding-left: 42px;
    border-radius: 10px;
    background: var(--surface);
  }

  .trigger {
    font-weight: 600;
  }

  .trigger.on {
    border-color: var(--accent);
  }

  .trigger[aria-expanded='true'] {
    background: var(--surface-2);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    box-sizing: border-box;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 12px;
    font-weight: 700;
  }

  .panel {
    position: absolute;
    z-index: 10;
    top: calc(100% + 8px);
    right: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-sizing: border-box;
    width: 360px;
    max-width: 100%;
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    padding: 16px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: 0 16px 40px rgb(0 0 0 / 35%);
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  section + section {
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  h3,
  legend {
    margin: 0 0 4px;
    padding: 0;
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
  }

  h3 {
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  legend {
    margin-top: 8px;
    font-size: 13px;
  }

  fieldset {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    box-sizing: border-box;
    width: 100%;
    min-height: 44px;
    padding: 0 12px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .row:hover:not(:disabled) {
    background: var(--surface-2);
  }

  .row[aria-pressed='true'],
  .row:has(input:checked) {
    border-color: var(--accent);
    background: var(--surface-2);
  }

  .row:disabled {
    color: var(--muted);
    cursor: default;
  }

  .row:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .choice {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }

  .count {
    color: var(--muted);
  }

  .count.todo {
    color: var(--warn);
    font-weight: 600;
  }

  /* On a phone the panel is a sheet at the foot of the screen: hanging from the bar it would run
     past the bottom edge, with the page behind it to scroll as well. */
  @media (max-width: 640px) {
    .panel {
      position: fixed;
      top: auto;
      right: 8px;
      bottom: 8px;
      left: 8px;
      width: auto;
      max-height: calc(100dvh - 16px);
    }
  }

  footer {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  .quiet {
    border-color: transparent;
    color: var(--muted);
  }
</style>
