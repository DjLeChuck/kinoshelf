<script lang="ts">
  import { formatBytes } from '@kinoshelf/i18n';
  import { locale, t } from '../lib/i18n.svelte.js';
  import { versionStatus } from '../lib/fiche.js';
  import { baseName } from '../lib/paths.js';
  import { HDR_LABEL, languageName, languageShort } from '../lib/versions.js';
  import type { ExternalSubtitle, Version } from '../lib/library-items.js';

  // One column per version, titled by its resolution (a single one for a single version), shared
  // by the movie and the episode. From three versions on it scrolls sideways inside its frame
  // while the labels stay in view.
  let { versions }: { versions: readonly Version[] } = $props();

  type Row = {
    readonly key:
      'hdr' | 'video' | 'audio' | 'subtitles' | 'subtitleFiles' | 'size' | 'file' | 'status';
    readonly read: (version: Version) => string;
  };
  const dash = '—';
  /** A language as a short tag (`FR`), its full name on hover. */
  interface Tag {
    readonly text: string;
    readonly title: string;
  }
  /** The tracks inside the video, tagged by the language ffprobe reads. */
  const trackTags = (codes: readonly string[]): Tag[] =>
    codes.map((code) => ({ text: languageShort(code), title: languageName(code, locale.value) }));
  /** The files beside the video: `EN forcés` (`English (forced)` on hover), `?` for a name with no language. */
  const fileTags = (subtitles: readonly ExternalSubtitle[]): Tag[] =>
    subtitles.map(({ language, forced, sdh }) => {
      const flags = [
        ...(forced ? [t('web.library.subtitles.forced')] : []),
        ...(sdh ? [t('web.library.subtitles.sdh')] : []),
      ];
      // The tag keeps to the short words; the hover says them in full (`SME` is not self-explanatory).
      const full = [
        ...(forced ? [t('web.library.subtitles.forced')] : []),
        ...(sdh ? [t('web.library.subtitles.sdh-long')] : []),
      ];
      const name =
        language === null
          ? t('web.library.subtitles.unknown')
          : languageName(language, locale.value);
      return {
        text: [language === null ? '?' : languageShort(language), ...flags].join(' '),
        title: full.length > 0 ? `${name} (${full.join(', ')})` : name,
      };
    });
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
    // Both subtitle rows are tags, drawn by the template: a track and a file never share a line.
    { key: 'subtitles', read: () => '' },
    { key: 'subtitleFiles', read: () => '' },
    { key: 'size', read: (v) => (v.file ? formatBytes(v.file.size, locale.value) : dash) },
    { key: 'file', read: (v) => baseName(v.path) },
    { key: 'status', read: (v) => t(`web.library.version.status.${versionStatus(v)}`) },
  ];
  // A subtitle row is there only when a version has something to put in it: otherwise it would be a
  // line of dashes. The tracks and the files follow the same rule.
  const filled = (key: Row['key'], version: Version): boolean =>
    key === 'subtitles'
      ? (version.file?.subtitleLanguages.length ?? 0) > 0
      : (version.subtitles?.length ?? 0) > 0;
  const shown = $derived(
    rows.filter(
      (row) =>
        (row.key !== 'subtitles' && row.key !== 'subtitleFiles') ||
        versions.some((version) => filled(row.key, version)),
    ),
  );
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
      {#each shown as row (row.key)}
        <tr>
          <th scope="row">{t(`web.library.compare.${row.key}`)}</th>
          {#each versions as version (version.id)}
            <td class:mono={row.key === 'file'}>
              {#if row.key === 'status'}
                {#if version.file?.unreadable}
                  <span class="chip chip-danger" title={version.file.unreadable}
                    >{t('web.library.version.status.unreadable')}</span
                  >
                  <span class="reason">{version.file.unreadable}</span>
                {/if}
                <span class="chip chip-{versionStatus(version) === 'complete' ? 'ok' : 'warn'}"
                  >{row.read(version)}</span
                >
              {:else if row.key === 'subtitles' || row.key === 'subtitleFiles'}
                {@const tags =
                  row.key === 'subtitles'
                    ? trackTags(version.file?.subtitleLanguages ?? [])
                    : fileTags(version.subtitles ?? [])}
                {#each tags as tag (tag.text + tag.title)}
                  <abbr class="lang" title={tag.title}>{tag.text}</abbr>
                {:else}
                  {dash}
                {/each}
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

  /* A language as a tag: short, never broken in the middle, its name on hover. */
  .lang {
    display: inline-block;
    margin: 0 4px 4px 0;
    padding: 0 6px;
    border: 1px solid var(--border);
    border-radius: 10px;
    font-size: 11.5px;
    text-decoration: none;
    white-space: nowrap;
    cursor: help;
  }

  .compare th[scope='row'] {
    color: var(--muted);
    font-weight: 600;
    white-space: nowrap;
  }

  .mono {
    font-size: 12px;
  }

  .reason {
    display: block;
    margin-top: 2px;
    color: var(--muted);
  }
</style>
