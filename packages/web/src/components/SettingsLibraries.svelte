<script lang="ts">
  import { messageOf } from '../lib/errors.js';
  import { resource } from '../lib/resource.svelte.js';
  import { t } from '../lib/i18n.svelte.js';
  import { groupOf, libraryApi, type Library, type LibraryGroup } from '../lib/libraries.js';
  import type { Naming, NamingExample } from '../lib/settings.js';
  import LibraryForm from './LibraryForm.svelte';

  let { examples }: { examples: Readonly<Record<Naming, NamingExample>> } = $props();

  const GROUPS: readonly LibraryGroup[] = ['in-place', 'arrival'];

  /** The library being edited, or the group of the one being created. */
  let editing = $state<{ id: string } | { group: LibraryGroup } | undefined>(undefined);
  let dialog = $state<HTMLDialogElement | undefined>(undefined);

  // The form lives in a modal: opened as soon as it is mounted.
  $effect(() => {
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  });

  // Libraries are part of the settings: any change of them, here or elsewhere, comes as such.
  const loaded = resource(() => libraryApi.list(), ['settings', 'ready']);
  const libraries = $derived(loaded.value);
  const failure = $derived(loaded.failure);

  const current = $derived.by(() => {
    const target = editing;
    return target && 'id' in target ? libraries?.find(({ id }) => id === target.id) : undefined;
  });

  /** What a library writes, `default` where it follows the settings. */
  function profileLabel(library: Library): { naming: string; metadata: string } {
    return {
      naming: library.naming
        ? t(`web.profile.naming.${library.naming}`)
        : t('web.libraries.default'),
      metadata: library.metadata
        ? t(`web.profile.metadata.${library.metadata}`)
        : t('web.libraries.default'),
    };
  }

  function close(): void {
    editing = undefined;
    void loaded.reload();
  }

  const nameOf = (id: string): string => libraries?.find((one) => one.id === id)?.name ?? id;
</script>

<section class="card" aria-labelledby="libraries-title">
  <h2 id="libraries-title">{t('web.settings.libraries.title')}</h2>
  <p class="muted hint">{t('web.settings.libraries.intro')}</p>

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {:else if libraries === undefined}
    <p class="muted" role="status">{t('web.loading')}</p>
  {:else}
    {#each GROUPS as group (group)}
      {@const members = libraries.filter((library) => groupOf(library) === group)}
      <div class="group">
        <div class="group-head">
          <h3>{t(`web.libraries.group.${group}`)}</h3>
          <button
            type="button"
            class="btn"
            onclick={() => {
              editing = { group };
            }}>{t('web.libraries.add')}</button
          >
        </div>
        {#if members.length === 0}
          <p class="muted hint">{t(`web.libraries.group.${group}.empty`)}</p>
        {:else}
          <ul class="list">
            {#each members as library (library.id)}
              <li>
                <button
                  type="button"
                  class="row"
                  aria-current={current?.id === library.id ? 'true' : undefined}
                  onclick={() => {
                    editing = { id: library.id };
                  }}
                >
                  <span class="top">
                    <strong>{library.name}</strong>
                    {#if library.type}<span class="chip chip-neutral"
                        >{t(`web.libraries.type.${library.type}`)}</span
                      >{/if}
                    {#if library.watch}<span class="chip chip-ok"
                        >{t('web.libraries.chip.watched')}</span
                      >{/if}
                  </span>
                  <span class="muted mono path">{library.source}</span>
                  <span class="muted hint">
                    {#if library.into}
                      {t('web.libraries.summary.into', {
                        movie: nameOf(library.into.movie),
                        series: nameOf(library.into.series),
                      })}
                    {:else}
                      {t('web.libraries.summary.profile', profileLabel(library))}
                    {/if}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/each}

    {#if editing}
      {#key current?.id ?? ('group' in editing ? editing.group : '')}
        {#if 'group' in editing || current}
          <dialog
            bind:this={dialog}
            aria-label={t('web.settings.libraries.title')}
            onclose={close}
            onclick={(event) => {
              // Only the backdrop is the dialog itself: the form fills the rest.
              if (event.target === dialog) {
                dialog.close();
              }
            }}
          >
            <LibraryForm
              library={current}
              group={current ? groupOf(current) : 'group' in editing ? editing.group : 'in-place'}
              {examples}
              {libraries}
              onsaved={() => {
                if (!current) {
                  close();
                } else {
                  void loaded.reload();
                }
              }}
              ondeleted={close}
              oncancel={close}
            />
          </dialog>
        {/if}
      {/key}
    {/if}
  {/if}
</section>

<style>
  dialog {
    width: min(720px, 96vw);
    max-height: 92vh;
    padding: 16px;
    color: var(--text);
    background: var(--bg, var(--surface));
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow-y: auto;
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 55%);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  h3 {
    font-size: 14px;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    width: 100%;
    min-height: 44px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    text-align: left;
    cursor: pointer;
  }

  .row:hover {
    background: var(--surface-2);
  }

  .row[aria-current='true'] {
    border-color: var(--accent);
  }

  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .path {
    font-size: 11px;
    overflow-wrap: anywhere;
  }
</style>
