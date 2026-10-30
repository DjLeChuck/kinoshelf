<script lang="ts">
  import Link from '../components/Link.svelte';
  import LibraryForm from '../components/LibraryForm.svelte';
  import { api } from '../lib/api.js';
  import { messageOf } from '../lib/errors.js';
  import { refetchOn } from '../lib/events.svelte.js';
  import { formatDate } from '../lib/history.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import {
    countTotal,
    folderName,
    libraryApi,
    libraryPath,
    scanPath,
    type Library,
    type LibraryForm as Draft,
    type LibraryRoute,
  } from '../lib/libraries.js';
  import { router } from '../lib/router.svelte.js';
  import { CUSTOM_PROFILE, profileName, type Settings } from '../lib/settings.js';

  let { route }: { route: Exclude<LibraryRoute, { page: 'scan' }> } = $props();

  let libraries = $state<readonly Library[] | undefined>(undefined);
  let profiles = $state<Settings['profiles']>([]);
  let failure = $state<unknown>(undefined);
  // What is typed in the creation form, shown in the list as it would be once saved.
  let draft = $state<Draft | undefined>(undefined);

  async function load(): Promise<void> {
    try {
      const [list, settings] = await Promise.all([
        libraryApi.list(),
        api.get<Settings>('/api/settings'),
      ]);
      libraries = list;
      profiles = settings.profiles;
      failure = undefined;
    } catch (error) {
      failure = error;
    }
  }

  // Libraries are part of the settings: any change of them, here or elsewhere, comes as such.
  refetchOn(['settings', 'jobs', 'ready'], () => void load());

  // `/libraries` alone shows the first one, as the list does.
  const current = $derived(
    route.page === 'new'
      ? undefined
      : libraries?.find((library) => library.id === (route.id ?? libraries?.[0]?.id)),
  );
  const missing = $derived(route.page === 'edit' && libraries !== undefined && !current);

  function profileLabel(library: Library): string {
    if (library.profile === null) {
      return t('web.libraries.default');
    }
    const bundled = profiles.find(({ id }) => id === library.profile);
    return bundled ? profileName(bundled, t) : folderName(library.profile);
  }

  function draftProfile(form: Draft): string {
    if (form.profile.choice === '') {
      return t('web.libraries.default');
    }
    if (form.profile.choice === CUSTOM_PROFILE) {
      return form.profile.path.trim() === ''
        ? t('web.settings.processing.profile.custom')
        : folderName(form.profile.path.trim());
    }
    const bundled = profiles.find(({ id }) => id === form.profile.choice);
    return bundled ? profileName(bundled, t) : form.profile.choice;
  }

  const scanState = (library: Library): 'running' | 'failed' | 'done' | undefined => {
    const status = library.lastScan?.status;
    return status === 'queued' || status === 'running' ? 'running' : status;
  };

  function lastScan(library: Library): string {
    const state = scanState(library);
    if (state === 'running' || state === 'failed') {
      return t(`web.libraries.lastscan.${state}`);
    }
    if (library.watch) {
      return t('web.libraries.watching');
    }
    return library.lastScan?.finishedAt
      ? t('web.libraries.lastscan', { date: formatDate(library.lastScan.finishedAt, locale.value) })
      : t('web.libraries.lastscan.never');
  }
</script>

<div class="page">
  <div class="head">
    <h1>{t('web.libraries.title')}</h1>
    <p class="muted">{t('web.libraries.intro')}</p>
  </div>

  {#if failure}
    <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
  {:else if libraries === undefined}
    <p class="muted" role="status">{t('web.loading')}</p>
  {:else}
    <div class="layout">
      <section aria-label={t('web.libraries.list.label')} class="side">
        <Link
          href="/libraries/new"
          class="btn add"
          aria-current={route.page === 'new' ? 'page' : undefined}>{t('web.libraries.add')}</Link
        >
        {#if libraries.length === 0}
          <p class="muted">{t('web.libraries.empty')}</p>
        {/if}
        <ul class="list">
          {#if route.page === 'new' && draft}
            <li>
              <div class="item current draft" aria-current="page">
                <span class="line">
                  <span class="name"
                    >{draft.name.trim() ||
                      (draft.source.trim() ? folderName(draft.source.trim()) : '') ||
                      t('web.libraries.new.title')}</span
                  >
                  <span class="chip" class:chip-ok={draft.watch} class:chip-neutral={!draft.watch}
                    >{t(
                      draft.watch ? 'web.libraries.chip.watched' : 'web.libraries.chip.manual',
                    )}</span
                  >
                </span>
                <span class="mono muted small">{draft.source.trim() || '/…'}</span>
                <span class="muted small"
                  >{t('web.libraries.summary', {
                    profile: draftProfile(draft),
                    mode: draft.mode
                      ? t(`web.settings.processing.mode.${draft.mode}`)
                      : t('web.settings.processing.mode.default'),
                  })} · {t('web.libraries.draft')}</span
                >
              </div>
            </li>
          {/if}
          {#each libraries as library (library.id)}
            <li>
              <Link
                href={libraryPath(library.id)}
                class={current?.id === library.id ? 'item current' : 'item'}
                aria-current={current?.id === library.id ? 'page' : undefined}
              >
                <span class="line">
                  <span class="name">{library.name}</span>
                  <span
                    class="chip"
                    class:chip-ok={library.watch}
                    class:chip-neutral={!library.watch}
                    >{t(
                      library.watch ? 'web.libraries.chip.watched' : 'web.libraries.chip.manual',
                    )}</span
                  >
                </span>
                <span class="mono muted small">{library.source}</span>
                <span class="muted small"
                  >{t('web.libraries.summary', {
                    profile: profileLabel(library),
                    mode: library.mode
                      ? t(`web.settings.processing.mode.${library.mode}`)
                      : t('web.settings.processing.mode.default'),
                  })} · {lastScan(library)}</span
                >
              </Link>
            </li>
          {/each}
        </ul>
      </section>

      <div class="detail">
        {#if route.page === 'new'}
          {#key 'new'}
            <LibraryForm
              {profiles}
              ondraft={(form: Draft) => {
                draft = form;
              }}
              onsaved={(created: Library) => {
                router.navigate(libraryPath(created.id));
                void load();
              }}
              ondeleted={() => undefined}
            />
          {/key}
        {:else if current}
          {#key current.id}
            <LibraryForm
              library={current}
              {profiles}
              lastScan={current.lastScan
                ? {
                    href: scanPath(current.id, current.lastScan.jobId),
                    label: t(`web.libraries.scan.link.${scanState(current) ?? 'done'}`),
                    ...(scanState(current) === 'done' && {
                      summary: t('web.libraries.lastscan.counts', {
                        total: countTotal(current.lastScan.counts),
                        rename: current.lastScan.counts.rename,
                        ambiguous: current.lastScan.counts.ambiguous,
                      }),
                    }),
                  }
                : undefined}
              onsaved={() => void load()}
              ondeleted={() => {
                router.navigate('/libraries');
                void load();
              }}
            />
          {/key}
        {:else}
          <p class="muted">{t(missing ? 'web.libraries.missing' : 'web.libraries.select')}</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  h1 {
    font-size: 22px;
    margin-bottom: 4px;
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(260px, 340px) 1fr;
    gap: 16px;
    align-items: start;
  }

  /* Stays in view while the form beside it scrolls, as the settings menu does. */
  .side {
    position: sticky;
    top: 24px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: calc(100vh - 48px);
    overflow-y: auto;
  }

  .side :global(.add) {
    align-self: flex-start;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .list :global(.item),
  .list .item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 44px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: inherit;
    text-decoration: none;
  }

  .list :global(a.item:hover) {
    background: var(--surface-2);
  }

  .list :global(.item.current),
  .list .item.current {
    border-color: var(--accent);
  }

  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .name {
    font-weight: 600;
  }

  .small {
    font-size: 11.5px;
    overflow-wrap: anywhere;
  }

  .detail {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  @media (max-width: 860px) {
    .layout {
      grid-template-columns: 1fr;
    }

    .side {
      position: static;
      max-height: none;
      overflow-y: visible;
    }
  }
</style>
