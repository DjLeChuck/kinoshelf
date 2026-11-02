<script lang="ts">
  import { messageOf } from '../lib/errors.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { t } from '../lib/i18n.svelte.js';
  import {
    folderName,
    groupOf,
    libraryApi,
    type Library,
    type LibraryGroup,
  } from '../lib/libraries.js';
  import { profileName, type ShippedProfile } from '../lib/settings.js';
  import LibraryForm from './LibraryForm.svelte';

  let { profiles }: { profiles: readonly ShippedProfile[] } = $props();

  const GROUPS: readonly LibraryGroup[] = ['in-place', 'arrival'];

  let libraries = $state<readonly Library[] | undefined>(undefined);
  let failure = $state<unknown>(undefined);
  /** The library being edited, or the group of the one being created. */
  let editing = $state<{ id: string } | { group: LibraryGroup } | undefined>(undefined);

  async function load(): Promise<void> {
    try {
      libraries = await libraryApi.list();
      failure = undefined;
    } catch (error) {
      failure = error;
    }
  }

  // Libraries are part of the settings: any change of them, here or elsewhere, comes as such.
  refetchOn(['settings', 'ready'], () => void load());

  const current = $derived.by(() => {
    const target = editing;
    return target && 'id' in target ? libraries?.find(({ id }) => id === target.id) : undefined;
  });

  function profileLabel(library: Library): string {
    if (library.profile === null) {
      return t('web.libraries.default');
    }
    const bundled = profiles.find(({ id }) => id === library.profile);
    return bundled ? profileName(bundled, t) : folderName(library.profile);
  }

  function close(): void {
    editing = undefined;
    void load();
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
                      {t('web.libraries.summary.profile', { profile: profileLabel(library) })}
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
          <LibraryForm
            library={current}
            group={current ? groupOf(current) : 'group' in editing ? editing.group : 'in-place'}
            {profiles}
            {libraries}
            onsaved={() => {
              if (!current) {
                close();
              } else {
                void load();
              }
            }}
            ondeleted={close}
            oncancel={close}
          />
        {/if}
      {/key}
    {/if}
  {/if}
</section>

<style>
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

  .hint {
    font-size: 12px;
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
