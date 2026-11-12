<script lang="ts">
  import { formatBytes } from '@kinoshelf/i18n';
  import { locale, t } from '../lib/i18n.svelte.js';
  import { versionStatus } from '../lib/fiche.js';
  import { baseName } from '../lib/paths.js';
  import { HDR_LABEL, languageName } from '../lib/versions.js';
  import type { Version } from '../lib/library-items.js';

  // One column per version, titled by its resolution (a single one for a single version), shared
  // by the movie and the episode. From three versions on it scrolls sideways inside its frame
  // while the labels stay in view.
  let { versions }: { versions: readonly Version[] } = $props();

  type Row = {
    readonly key: 'hdr' | 'video' | 'audio' | 'subtitles' | 'size' | 'file' | 'status';
    readonly read: (version: Version) => string;
  };
  const dash = '—';
  const names = (codes: readonly string[]): string =>
    codes.map((code) => languageName(code, locale.value)).join(', ');
  // One line per fact; a file not read yet has none to give.
  const rows: readonly Row[] = [
    {
      key: 'hdr',
      read: (v) =>
        v.file === null ? dash : v.file.hdr ? HDR_LABEL[v.file.hdr] : t('web.library.compare.sdr'),
    },
    { key: 'video', read: (v) => v.file?.video ?? dash },
    {
      key: 'audio',
      read: (v) =>
        [v.file?.audio, names(v.file?.audioLanguages ?? [])].filter(Boolean).join(' · ') || dash,
    },
    { key: 'subtitles', read: (v) => names(v.file?.subtitleLanguages ?? []) || dash },
    { key: 'size', read: (v) => (v.file ? formatBytes(v.file.size, locale.value) : dash) },
    { key: 'file', read: (v) => baseName(v.path) },
    { key: 'status', read: (v) => t(`web.library.version.status.${versionStatus(v)}`) },
  ];
</script>

<div class="scroll">
  <table class="compare" class:single={versions.length === 1}>
    <caption class="sr-only">{t('web.library.versions.table')}</caption>
    <thead>
      <tr>
        <th scope="col"><span class="sr-only">{t('web.library.compare.feature')}</span></th>
        {#each versions as version (version.id)}
          <th scope="col">{version.resolution ?? t('web.library.version.unknown')}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.key)}
        <tr>
          <th scope="row">{t(`web.library.compare.${row.key}`)}</th>
          {#each versions as version (version.id)}
            <td class:mono={row.key === 'file'}>
              {#if row.key === 'status'}
                <span class="chip chip-{versionStatus(version) === 'complete' ? 'ok' : 'warn'}"
                  >{row.read(version)}</span
                >
              {:else}
                {row.read(version)}
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .scroll {
    overflow-x: auto;
  }

  .compare {
    width: max-content;
    min-width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }

  .compare th,
  .compare td {
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
    overflow-wrap: anywhere;
  }

  /* The versions make the columns, so there is no telling how many: the table scrolls sideways
     rather than crushing the names of the lines, which stay in view. */
  .compare td,
  .compare th[scope='col'] {
    min-width: 64px;
    /* A long file name wraps in its column instead of widening every one of them. */
    max-width: 92px;
  }

  /* A single version has room: the labels keep their width and the value takes the rest, so a
     file name wraps at its words instead of letter by letter. */
  .compare.single {
    width: 100%;
    table-layout: fixed;
  }

  .compare.single th[scope='row'],
  .compare.single thead th:first-child {
    width: 124px;
  }

  .compare.single td,
  .compare.single th[scope='col'] {
    max-width: none;
  }

  /* The corner is held with the names of the lines, so a header scrolling sideways never slides over it. */
  .compare th[scope='row'],
  .compare thead th:first-child {
    position: sticky;
    left: 0;
    z-index: 1;
    box-shadow: 1px 0 0 var(--border);
    background: var(--surface);
  }

  .compare th[scope='row'] {
    color: var(--muted);
    font-weight: 600;
    white-space: nowrap;
  }

  .mono {
    font-size: 12px;
  }
</style>
