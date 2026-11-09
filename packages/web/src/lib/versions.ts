import type { Hdr, ProbedFile } from './library-items.js';

/** The names of the formats are the same in every language. */
export const HDR_LABEL: Readonly<Record<Hdr, string>> = {
  'dolby-vision': 'Dolby Vision',
  'hdr10-plus': 'HDR10+',
  hdr10: 'HDR10',
  hlg: 'HLG',
};

// Files tag languages with ISO 639-2 (`fre`, `eng`); Intl and the eye want the two letters.
// Both the bibliographic and the terminologic codes of a language are listed (`fre`, `fra`).
const TWO_LETTERS: Readonly<Record<string, string>> = {
  ara: 'ar',
  chi: 'zh',
  cze: 'cs',
  ces: 'cs',
  dan: 'da',
  dut: 'nl',
  nld: 'nl',
  eng: 'en',
  fin: 'fi',
  fre: 'fr',
  fra: 'fr',
  ger: 'de',
  deu: 'de',
  gre: 'el',
  ell: 'el',
  heb: 'he',
  hin: 'hi',
  hun: 'hu',
  ita: 'it',
  jpn: 'ja',
  kor: 'ko',
  nor: 'no',
  pol: 'pl',
  por: 'pt',
  rum: 'ro',
  ron: 'ro',
  rus: 'ru',
  spa: 'es',
  swe: 'sv',
  tha: 'th',
  tur: 'tr',
  ukr: 'uk',
  zho: 'zh',
};

/** `FR` for `fre`; a code nobody here knows (`ine`) is shown as the file gives it. */
export const languageShort = (code: string): string => (TWO_LETTERS[code] ?? code).toUpperCase();

/** `French` or `français` for `fre`, in the language of the page; an unknown code as it is. */
export function languageName(code: string, locale: string): string {
  const two = TWO_LETTERS[code];
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
