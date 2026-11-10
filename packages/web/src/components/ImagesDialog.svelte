<script lang="ts">
  import { api } from '../lib/api.js';
  import { imageUrl, workImageUrl, type ImageKind } from '../lib/arrivals.js';
  import { messageOf } from '../lib/errors.js';
  import { locale, t } from '../lib/i18n.svelte.js';
  import {
    baseLanguage,
    IMAGE_KINDS,
    isImageAddress,
    KIND_LAYOUT,
    languagesOf,
    sizeLabel,
    sortCandidates,
    type AddressPreview,
    type Candidate,
    type ImageChoice,
    type ImageListing,
  } from '../lib/images.js';
  import type { Settings } from '../lib/settings.js';

  let {
    base,
    initial,
    kinds = IMAGE_KINDS,
    heading: headingOverride,
    onclose,
    ondone,
  }: {
    /** The work's API path (`/api/libraries/:id/items/:itemId`, `.../shows/:tmdbId`). */
    base: string;
    /** The tab to open on. */
    initial: ImageKind;
    /** The tabs to offer: a work's three images by default, an episode's one. */
    kinds?: readonly ImageKind[];
    /** What to call the work in the title, when the listing's title is not it. */
    heading?: string;
    onclose: () => void;
    /** The images were replaced: what to tell the user. */
    ondone: (message: string) => void;
  } = $props();

  type Pick = { readonly source: 'tmdb' | 'url'; readonly value: string };

  let listing = $state<ImageListing | undefined>(undefined);
  let failure = $state<unknown>(undefined);
  let language = $state(baseLanguage(locale.value));
  // Set from the prop once: the parent mounts the dialog for one opening.
  /* svelte-ignore state_referenced_locally */
  let tab = $state<ImageKind>(initial);
  let filter = $state<'all' | { readonly code: string | null }>('all');
  // What is chosen on each tab, kept while the user looks at another one.
  let picks = $state<Partial<Record<ImageKind, Pick>>>({});
  let address = $state('');
  let addressError = $state(false);
  let loadingAddress = $state(false);
  // What each tab's address gave, kept with the address it was read at.
  let previews = $state<Partial<Record<ImageKind, AddressPreview & { readonly url: string }>>>({});
  let addressFailure = $state<unknown>(undefined);
  let applying = $state(false);
  let dialog: HTMLDialogElement | undefined;

  $effect(() => {
    dialog?.showModal();
  });

  async function load(): Promise<void> {
    try {
      listing = await api.get<ImageListing>(`${base}/images`);
    } catch (error) {
      failure = error;
    }
    // The language the library asks TMDB for orders the grid; the interface's is the fallback.
    try {
      const settings = await api.get<Settings>('/api/settings');
      if (settings.tmdb.language) {
        language = baseLanguage(settings.tmdb.language);
      }
    } catch {
      // The grid then follows the interface's language.
    }
  }
  void load();

  const layout = $derived(KIND_LAYOUT[tab]);
  const names = $derived(
    new Intl.DisplayNames([locale.value], { type: 'language', fallback: 'code' }),
  );
  const languageLabel = (code: string | null): string =>
    code === null ? t('web.images.language.none') : (names.of(code) ?? code);
  const candidates = $derived(listing?.candidates[tab] ?? []);
  const languages = $derived(languagesOf(sortCandidates(candidates, language)));
  const shown = $derived(
    sortCandidates(candidates, language).filter(
      (candidate) => filter === 'all' || candidate.language === filter.code,
    ),
  );
  const current = $derived(listing?.current[tab] ?? null);
  const picked = $derived(picks[tab]);
  // What the profile writes under that name: the only format an address may give.
  const formatOf = (file: string): string => (file.endsWith('.png') ? 'PNG' : 'JPEG');
  const fileOf = (kind: ImageKind): string => listing?.files[kind] ?? '';
  const changes = $derived(kinds.filter((kind) => picks[kind] !== undefined));
  const summary = $derived(
    changes.length === 0
      ? t('web.images.summary.none')
      : t('web.images.summary', {
          count: changes.length,
          files: changes.map(fileOf).join(', '),
        }),
  );

  // Thumbnails come through our own server: the browser never contacts TMDB.
  const thumbSize = (kind: ImageKind): 'w342' | 'w300' => (kind === 'poster' ? 'w342' : 'w300');
  const thumb = (path: string): string | undefined => imageUrl(thumbSize(tab), path);
  const bigThumb = (path: string): string | undefined =>
    imageUrl(
      tab === 'poster' ? 'w342' : tab === 'fanart' || tab === 'thumb' ? 'w780' : 'w500',
      path,
    );
  const describe = (candidate: Candidate): string =>
    t('web.images.source.tmdb', {
      language: languageLabel(candidate.language),
      size: sizeLabel(candidate),
    });
  const chosenAddress = $derived(
    picked?.source === 'url' && previews[tab]?.url === picked.value ? previews[tab] : undefined,
  );
  const chosenCandidate = $derived(
    picked?.source === 'tmdb'
      ? candidates.find((candidate) => candidate.path === picked.value)
      : undefined,
  );

  function choose(candidate: Candidate): void {
    // The image already in place is no change: choosing it again leaves nothing to write.
    const same = picked?.source === 'tmdb' && picked.value === candidate.path;
    const place = current?.path === candidate.path;
    picks =
      same || place
        ? withoutTab(picks, tab)
        : { ...picks, [tab]: { source: 'tmdb', value: candidate.path } };
  }

  const withoutTab = (all: Partial<Record<ImageKind, Pick>>, kind: ImageKind) =>
    Object.fromEntries(Object.entries(all).filter(([key]) => key !== kind)) as Partial<
      Record<ImageKind, Pick>
    >;

  async function loadAddress(): Promise<void> {
    if (!isImageAddress(address)) {
      addressError = true;
      return;
    }
    addressError = false;
    addressFailure = undefined;
    loadingAddress = true;
    const kind = tab;
    const url = address.trim();
    try {
      const found = await api.post<AddressPreview>(`${base}/images/preview`, { type: kind, url });
      previews = { ...previews, [kind]: { ...found, url } };
      picks = { ...picks, [kind]: { source: 'url', value: url } };
    } catch (error) {
      addressFailure = error;
    } finally {
      loadingAddress = false;
    }
  }

  // Takes back what was chosen on this tab, an address included: nothing is left to write for it.
  function discard(): void {
    if (picked?.source === 'url') {
      address = '';
      addressFailure = undefined;
    }
    picks = withoutTab(picks, tab);
  }

  function pickTab(kind: ImageKind): void {
    tab = kind;
    filter = 'all';
    address = '';
    addressError = false;
    addressFailure = undefined;
  }

  function moveTab(event: KeyboardEvent): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const next = kinds[(kinds.indexOf(tab) + step + kinds.length) % kinds.length];
    if (next) {
      pickTab(next);
      document.getElementById(`images-tab-${next}`)?.focus();
    }
  }

  async function apply(): Promise<void> {
    applying = true;
    failure = undefined;
    const images: ImageChoice[] = changes.flatMap((type) => {
      const pick = picks[type];
      return pick ? [{ type, source: pick.source, value: pick.value }] : [];
    });
    try {
      await api.post(`${base}/images`, { images });
      ondone(t('web.images.done'));
      dialog?.close();
    } catch (error) {
      failure = error;
      applying = false;
    }
  }

  const heading = $derived(
    t('web.images.title', {
      title:
        headingOverride ??
        `${listing?.title ?? ''}${listing?.year ? ` (${listing.year})` : ''}`.trim(),
    }),
  );
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="images-title"
  {onclose}
  oncancel={(event) => {
    // Esc must not close what is being applied: the answer would go to nobody.
    if (applying) {
      event.preventDefault();
    }
  }}
  onclick={(event) => {
    // Only the backdrop is the dialog itself: the box fills the rest.
    if (event.target === dialog && !applying) {
      dialog.close();
    }
  }}
>
  <div class="box">
    <header>
      <div>
        <h2 id="images-title">{heading}</h2>
        <p class="muted">
          {t(
            kinds.length === 1 && kinds[0] === 'thumb'
              ? 'web.images.intro.episode'
              : 'web.images.intro',
          )}
        </p>
      </div>
      <button
        type="button"
        class="close"
        aria-label={t('web.images.close')}
        onclick={() => dialog?.close()}>×</button
      >
    </header>

    {#if kinds.length > 1}
      <div class="tabs" role="tablist" aria-label={t('web.images.tabs')}>
        {#each kinds as kind (kind)}
          <button
            type="button"
            role="tab"
            id={`images-tab-${kind}`}
            aria-selected={tab === kind}
            aria-controls="images-panel"
            tabindex={tab === kind ? 0 : -1}
            class:on={tab === kind}
            onclick={() => {
              pickTab(kind);
            }}
            onkeydown={moveTab}
          >
            {t(`web.images.tab.${kind}`)}
            <span class="count">{listing?.candidates[kind].length ?? ''}</span>
            {#if picks[kind]}<span class="dot" aria-hidden="true"></span>{/if}
          </button>
        {/each}
      </div>
    {/if}

    {#if listing === undefined && failure === undefined}
      <p class="muted pad" role="status">{t('web.loading')}</p>
    {:else if listing === undefined}
      <p class="alert alert-danger pad" role="alert">{messageOf(t, failure)}</p>
    {:else}
      <div
        class="panel"
        id="images-panel"
        role={kinds.length > 1 ? 'tabpanel' : 'group'}
        aria-labelledby={kinds.length > 1 ? `images-tab-${tab}` : undefined}
        aria-label={kinds.length > 1 ? undefined : t(`web.images.tab.${tab}`)}
      >
        <div class="body">
          <aside>
            <div class="side">
              <section>
                <h3>{t('web.images.current')}</h3>
                <div class="preview" class:logo={tab === 'logo'} style:aspect-ratio={layout.ratio}>
                  {#if current}
                    <img src={workImageUrl(base, tab, current.modified)} alt="" />
                  {:else}
                    <span class="empty">{t('web.images.none')}</span>
                  {/if}
                </div>
                {#if current}
                  <p class="caption">
                    {sizeLabel(current)}
                  </p>
                {/if}
              </section>
              <section>
                <h3 class="new">{t('web.images.new')}</h3>
                {#if picked}
                  <div
                    class="preview chosen"
                    class:logo={tab === 'logo'}
                    style:aspect-ratio={layout.ratio}
                  >
                    {#if chosenCandidate}
                      <img src={bigThumb(chosenCandidate.path)} alt="" />
                    {:else if chosenAddress}
                      <img src={chosenAddress.data} alt="" />
                    {:else}
                      <span class="address">{picked.value}</span>
                    {/if}
                  </div>
                  <p class="caption">
                    {chosenCandidate
                      ? describe(chosenCandidate)
                      : chosenAddress
                        ? `${t('web.images.source.url')} · ${sizeLabel(chosenAddress)}`
                        : t('web.images.source.url')}
                  </p>
                  <button type="button" class="btn discard" onclick={discard}>
                    {t('web.images.discard')}
                  </button>
                {:else}
                  <p class="none">{t('web.images.unchanged')}</p>
                {/if}
              </section>
              <dl>
                <dt>{t('web.images.file')}</dt>
                <dd class="mono">{fileOf(tab)}</dd>
                <dt>{t('web.images.folder')}</dt>
                <dd class="mono">{listing.folder}/</dd>
              </dl>
            </div>
          </aside>

          <section class="choose">
            <div class="list">
              <div class="bar">
                <div role="group" aria-label={t('web.images.language.group')} class="langs">
                  <button
                    type="button"
                    class="pill"
                    aria-pressed={filter === 'all'}
                    onclick={() => {
                      filter = 'all';
                    }}>{t('web.images.language.all')}</button
                  >
                  {#each languages as code (code)}
                    <button
                      type="button"
                      class="pill"
                      aria-pressed={filter !== 'all' && filter.code === code}
                      onclick={() => {
                        filter = { code };
                      }}>{languageLabel(code)}</button
                    >
                  {/each}
                </div>
                <span class="muted sort">{t('web.images.sort')}</span>
              </div>

              {#if candidates.length === 0}
                <p class="muted">{t('web.images.empty', { file: fileOf(tab) })}</p>
              {:else}
                <ul
                  class="grid"
                  aria-label={t('web.images.grid')}
                  style:grid-template-columns={`repeat(auto-fill, minmax(${layout.min}px, 1fr))`}
                >
                  {#each shown as candidate (candidate.path)}
                    {@const selected = picked?.source === 'tmdb' && picked.value === candidate.path}
                    <li>
                      <button
                        type="button"
                        class="card"
                        class:selected
                        aria-pressed={selected}
                        onclick={() => {
                          choose(candidate);
                        }}
                      >
                        <span
                          class="thumb"
                          class:logo={tab === 'logo'}
                          style:aspect-ratio={layout.ratio}
                        >
                          <img src={thumb(candidate.path)} alt="" loading="lazy" />
                          {#if current?.path === candidate.path}
                            <span class="badge">{t('web.images.current')}</span>
                          {/if}
                          {#if selected}<span class="tick" aria-hidden="true">✓</span>{/if}
                        </span>
                        <span class="line">
                          <span class="lang">{languageLabel(candidate.language)}</span>
                          <span class="muted">{sizeLabel(candidate)}</span>
                        </span>
                        <span class="muted rating">
                          {candidate.rating === null
                            ? ''
                            : `★ ${candidate.rating.toFixed(1)} · `}{t('web.images.votes', {
                            count: candidate.votes,
                          })}
                        </span>
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
            <div class="custom">
              <label for="images-address">{t('web.images.url.label')}</label>
              <div class="row">
                <input
                  id="images-address"
                  class="input"
                  type="url"
                  placeholder={t('web.images.url.placeholder', { file: fileOf(tab) })}
                  bind:value={address}
                  aria-invalid={addressError}
                  onkeydown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void loadAddress();
                    }
                  }}
                />
                <button
                  type="button"
                  class="btn"
                  disabled={loadingAddress}
                  onclick={() => void loadAddress()}
                  >{loadingAddress ? t('web.loading') : t('web.images.url.use')}</button
                >
              </div>
              {#if addressError}
                <p class="alert alert-danger" role="alert">{t('web.images.url.invalid')}</p>
              {:else if addressFailure !== undefined}
                <p class="alert alert-danger" role="alert">{messageOf(t, addressFailure)}</p>
              {:else if chosenAddress}
                <p class="ok" role="status">
                  {t('web.images.url.chosen', {
                    size: sizeLabel(chosenAddress),
                    format: chosenAddress.format.toUpperCase(),
                  })}
                </p>
              {:else}
                <p class="muted">
                  {t('web.images.url.hint', { format: formatOf(fileOf(tab)), file: fileOf(tab) })}
                </p>
              {/if}
            </div>
          </section>
        </div>
      </div>
    {/if}

    <footer>
      {#if failure !== undefined && listing !== undefined}
        <p class="alert alert-danger" role="alert">{messageOf(t, failure)}</p>
      {:else}
        <span class="muted">{summary}</span>
      {/if}
      <div class="actions">
        <button type="button" class="btn" disabled={applying} onclick={() => dialog?.close()}
          >{t('web.images.cancel')}</button
        >
        <button
          type="button"
          class="btn btn-primary"
          disabled={changes.length === 0 || applying}
          onclick={() => void apply()}
        >
          {applying ? t('web.images.applying') : t('web.images.apply')}
        </button>
      </div>
    </footer>
  </div>
</dialog>

<style>
  dialog {
    width: min(1180px, 96vw);
    max-height: 92vh;
    padding: 0;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  dialog[open] {
    display: flex;
    flex-direction: column;
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 55%);
  }

  .box {
    display: flex;
    flex-direction: column;
    min-height: 0;
    max-height: 92vh;
  }

  header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 24px 0;
  }

  h2 {
    margin: 0 0 4px;
    font-size: 20px;
  }

  h3 {
    margin: 0 0 8px;
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }

  h3.new {
    color: var(--accent-text);
  }

  p {
    margin: 0;
  }

  .close {
    flex: none;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    font-size: 24px;
    cursor: pointer;
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 12px;
    padding: 0 24px;
    border-bottom: 1px solid var(--border);
  }

  .tabs button {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 16px;
    margin-bottom: -1px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .tabs button.on {
    color: var(--text);
    border-bottom-color: var(--accent);
  }

  .count {
    font-size: 12px;
    font-weight: 500;
    color: var(--muted);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 4px;
    background: var(--accent);
  }

  .pad {
    margin: 24px;
  }

  .body {
    display: flex;
    flex-wrap: wrap;
    min-height: 0;
    overflow: auto;
  }

  aside {
    flex: 1 1 260px;
    max-width: 340px;
    box-sizing: border-box;
    /* The border is the aside's, which is as tall as the grid: it runs the whole separation. */
    border-right: 1px solid var(--border);
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 24px;
  }

  /* The grid scrolls, not the summary: side by side, the column stays in view. Stacked (narrow
     dialog), it would cover the grid, so it scrolls with it. */
  @media (min-width: 860px) {
    .side {
      position: sticky;
      top: 0;
      max-height: calc(92vh - 190px);
      overflow: auto;
    }
  }

  .preview {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }

  .preview.chosen {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .preview img,
  .thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* A logo is a transparent title: shown whole on a dark ground, never cropped. */
  .preview.logo,
  .thumb.logo {
    background: #20232a;
  }

  .preview.logo img,
  .thumb.logo img {
    object-fit: contain;
    padding: 8%;
    box-sizing: border-box;
  }

  .empty,
  .none {
    padding: 14px;
    color: var(--muted);
    font-size: 13px;
  }

  .none {
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    line-height: 1.5;
  }

  .address {
    padding: 10px;
    font-size: 12px;
    overflow-wrap: anywhere;
    color: var(--text);
  }

  .discard {
    margin-top: 10px;
    min-height: 44px;
  }

  .caption {
    margin-top: 6px;
    font-size: 12px;
    color: var(--muted);
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 12px;
    margin: 0;
    font-size: 13px;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .choose {
    flex: 999 1 520px;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 24px;
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .langs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .pill {
    min-height: 36px;
    padding: 0 14px;
    border: 1px solid var(--border);
    border-radius: 18px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .pill[aria-pressed='true'] {
    border-color: var(--accent);
    color: var(--accent-text);
  }

  .sort {
    font-size: 13px;
  }

  .grid {
    display: grid;
    gap: 14px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 0;
    overflow: hidden;
    border: 2px solid var(--border);
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .card.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgb(242 169 59 / 25%);
  }

  .thumb {
    position: relative;
    display: block;
    width: 100%;
  }

  .badge {
    position: absolute;
    top: 8px;
    left: 8px;
    padding: 3px 7px;
    border-radius: 5px;
    background: var(--text);
    color: var(--surface);
    font-size: 11px;
    font-weight: 600;
  }

  .tick {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 13px;
    background: var(--accent);
    color: #111318;
    font-weight: 700;
  }

  .line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 8px 10px 2px;
    font-size: 12px;
  }

  .lang {
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--surface);
    font-weight: 600;
  }

  .rating {
    padding: 0 10px 10px;
    font-size: 12px;
  }

  .panel {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  /* The address stays at the bottom of the right part while the images scroll behind it. */
  .custom {
    position: sticky;
    bottom: 0;
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 24px;
    border-top: 1px solid var(--border);
    background: var(--surface);
  }

  /* The images fade out above the address instead of being cut by its edge. */
  .custom::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    height: 28px;
    pointer-events: none;
    background: linear-gradient(to bottom, transparent, var(--surface));
  }

  .custom label {
    font-weight: 600;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .row .input {
    flex: 1 1 320px;
    min-width: 0;
    min-height: 44px;
  }

  .row .btn {
    min-height: 44px;
  }

  .ok {
    font-size: 13px;
    color: #4caf7d;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 24px;
    border-top: 1px solid var(--border);
    background: var(--surface-2);
  }

  footer .btn {
    min-height: 44px;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
