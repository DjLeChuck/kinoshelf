import { TWO_LETTERS } from '@kinoshelf/i18n';
import type { Coverage, Hdr, LibraryItem, ProbedFile } from './library-items.js';

/** The names of the formats are the same in every language. */
export const HDR_LABEL: Readonly<Record<Hdr, string>> = {
  'dolby-vision': 'Dolby Vision',
  'hdr10-plus': 'HDR10+',
  hdr10: 'HDR10',
  hlg: 'HLG',
};

/** `French` or `français` for `fre`, in the language of the page; an unknown code as it is. */
export function languageName(code: string, locale: string): string {
  // A subtitle file's name gives the two-letter code already; a track's tag gives three letters.
  const two = code.length === 2 ? code.toLowerCase() : TWO_LETTERS[code];
  if (two === undefined) {
    return code.toUpperCase();
  }
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(two) ?? two.toUpperCase();
  } catch {
    return two.toUpperCase();
  }
}

/** `2160p HDR10`: the size, then the dynamic range when it is not SDR. `null` size: not told. */
export const versionLabel = (
  resolution: string | null,
  file: Pick<ProbedFile, 'hdr'> | null,
): string[] => [
  ...(resolution === null ? [] : [resolution]),
  ...(file?.hdr ? [HDR_LABEL[file.hdr]] : []),
];

/** `hevc HDR10 · eac3 5.1`: what a sub-row says of a file besides its size and languages. */
export const codecLine = (file: ProbedFile | null): string =>
  file === null
    ? ''
    : [
        [file.video, file.hdr ? HDR_LABEL[file.hdr] : undefined].filter(Boolean).join(' '),
        file.audio,
      ]
        .filter(Boolean)
        .join(' · ');

/** The sum of the sizes that are known, `null` when none is. */
export function totalSize(files: readonly (Pick<ProbedFile, 'size'> | null)[]): number | null {
  const known = files.filter((file) => file !== null);
  return known.length === 0 ? null : known.reduce((sum, { size }) => sum + size, 0);
}

/** What a version of a show is, for one episode of it. */
export type SlotStatus = 'complete' | 'nfo-missing' | 'absent';

/** One version of the show, as it stands for one episode: the file that holds it, if any. */
export interface Slot {
  readonly resolution: string | null;
  readonly file: LibraryItem | undefined;
  readonly status: SlotStatus;
}

/**
 * Each version of the show (`coverage`, the season's) against the files of one episode: the file
 * of that size, or none when the version exists in the show but not for this episode. A missing
 * NFO is the file's own (`nfo === false`; `null` is a profile that writes none).
 */
export function slotsOf(
  coverage: readonly Pick<Coverage, 'resolution'>[],
  files: readonly LibraryItem[],
): Slot[] {
  return coverage.map(({ resolution }) => {
    const file = files.find((candidate) => candidate.resolution === resolution);
    return {
      resolution,
      file,
      status: file === undefined ? 'absent' : file.nfo === false ? 'nfo-missing' : 'complete',
    };
  });
}

/** A version held in full is plain, one that lacks episodes carries its ratio (`2160p 7/8`). */
export const isIncomplete = (coverage: Pick<Coverage, 'covered' | 'total' | 'accepted'>): boolean =>
  coverage.covered < coverage.total && !coverage.accepted;
