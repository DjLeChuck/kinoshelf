/**
 * The language of a subtitle file read from its name (`2_French.srt`, `fra.forced.srt`), as the
 * ISO 639-1 code players expect in `<video>.<code>.srt`. Names only: nothing here reads a file.
 */

/** ISO 639-1 code, then the words a release uses for it: English and native names, ISO 639-2 codes. */
const LANGUAGES: readonly (readonly [string, readonly string[]])[] = [
  ['en', ['english', 'eng', 'anglais', 'ingles', 'englisch', 'inglese']],
  ['fr', ['french', 'fre', 'fra', 'francais', 'francese', 'frances', 'franzosisch', 'vff', 'vfq']],
  ['es', ['spanish', 'spa', 'espanol', 'castellano', 'espagnol', 'spagnolo', 'latino']],
  ['de', ['german', 'ger', 'deu', 'deutsch', 'allemand', 'tedesco', 'aleman']],
  ['it', ['italian', 'ita', 'italiano', 'italien']],
  ['pt', ['portuguese', 'por', 'portugues', 'portugais', 'brazilian', 'brazil']],
  ['nl', ['dutch', 'dut', 'nld', 'nederlands', 'neerlandais', 'flemish']],
  ['sv', ['swedish', 'swe', 'svenska', 'suedois']],
  ['da', ['danish', 'dan', 'dansk', 'danois']],
  ['no', ['norwegian', 'nor', 'nob', 'norsk', 'norvegien']],
  ['fi', ['finnish', 'fin', 'suomi', 'finnois']],
  ['is', ['icelandic', 'ice', 'isl', 'islenska']],
  ['pl', ['polish', 'pol', 'polski', 'polonais']],
  ['cs', ['czech', 'cze', 'ces', 'cesky', 'tcheque']],
  ['sk', ['slovak', 'slo', 'slk', 'slovencina']],
  ['sl', ['slovenian', 'slv', 'slovenscina']],
  ['hu', ['hungarian', 'hun', 'magyar', 'hongrois']],
  ['ro', ['romanian', 'rum', 'ron', 'romana', 'roumain']],
  ['bg', ['bulgarian', 'bul', 'bulgare']],
  ['hr', ['croatian', 'hrv', 'hrvatski', 'croate']],
  ['sr', ['serbian', 'srp', 'srpski', 'serbe']],
  ['el', ['greek', 'gre', 'ell', 'ellinika', 'grec']],
  ['tr', ['turkish', 'tur', 'turkce', 'turc']],
  ['ru', ['russian', 'rus', 'russkiy', 'russe']],
  ['uk', ['ukrainian', 'ukr', 'ukrainien']],
  ['he', ['hebrew', 'heb', 'hebreu']],
  ['ar', ['arabic', 'ara', 'arabe']],
  ['fa', ['persian', 'farsi', 'per', 'fas', 'persan']],
  ['hi', ['hindi', 'hin']],
  ['th', ['thai', 'tha']],
  ['vi', ['vietnamese', 'vie', 'vietnamien']],
  ['id', ['indonesian', 'ind', 'indonesien']],
  ['ms', ['malay', 'may', 'msa']],
  [
    'zh',
    ['chinese', 'chi', 'zho', 'mandarin', 'cantonese', 'chinois', 'simplified', 'traditional'],
  ],
  ['ja', ['japanese', 'jpn', 'japonais']],
  ['ko', ['korean', 'kor', 'coreen']],
  ['et', ['estonian', 'est', 'eesti']],
  ['lv', ['latvian', 'lav']],
  ['lt', ['lithuanian', 'lit']],
  ['ca', ['catalan', 'cat']],
  ['ga', ['irish', 'gle']],
  ['sq', ['albanian', 'alb', 'sqi']],
  ['mk', ['macedonian', 'mac', 'mkd']],
  ['bs', ['bosnian', 'bos']],
];

/**
 * Words that are also everyday words or names (`no`, `it`, `is`, `cat`, `may`, `dan`, `spa`): taken
 * as a language only when nothing else in the name is a word, as in `it.srt`.
 */
const AMBIGUOUS = new Set([
  'no',
  'it',
  'is',
  'id',
  'he',
  'cat',
  'may',
  'ice',
  'lit',
  'est',
  'mac',
  'rum',
  'per',
  'spa',
  'dan',
  'fin',
  'ger',
  'gre',
  'ind',
  'ara',
  'bos',
  'tha',
  'alb',
  'slo',
  'hin',
  'dut',
  'nor',
  'pol',
  'por',
  'tur',
  'bul',
  'chi',
  'kor',
  'heb',
  'vie',
  'lav',
  'hun',
  'swe',
  'ukr',
  'rus',
  'ita',
]);

const BY_WORD = new Map<string, string>();
const CODES = new Set<string>();
for (const [code, words] of LANGUAGES) {
  CODES.add(code);
  for (const word of words) {
    BY_WORD.set(word, code);
  }
}

/** What a name says besides the language: a track for foreign speech only, or for the deaf. */
const FORCED = new Set(['forced', 'force', 'forces', 'forcee', 'forcees']);
const HEARING = new Set(['sdh', 'hi', 'cc', 'hearing', 'impaired']);

export interface SubtitleName {
  /** ISO 639-1; `undefined` when the name names none we know. */
  readonly language: string | undefined;
  readonly forced: boolean;
  readonly sdh: boolean;
}

/** Words of a name without its extension, lower case, accents and digits gone (`2_Français` → `francais`). */
function wordsOf(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

export function readSubtitleName(name: string): SubtitleName {
  const words = wordsOf(name);
  const forced = words.some((word) => FORCED.has(word));
  const sdh = words.some((word) => HEARING.has(word));

  // A language's name or its three-letter code is trusted anywhere, except the words that are
  // also words of any other kind. A bare two-letter code (`fr`, `de`) and those words count only
  // when they are all the name says: `Le Destin de Amélie.srt` is not German.
  const kept = words.filter((word) => !FORCED.has(word) && !HEARING.has(word));
  const lookup = (word: string): string | undefined =>
    BY_WORD.get(word) ?? (CODES.has(word) ? word : undefined);
  const sure = kept.find((word) => !AMBIGUOUS.has(word) && BY_WORD.has(word));
  const only = kept.length === 1 ? kept[0] : undefined;
  const word = sure ?? (only !== undefined && lookup(only) !== undefined ? only : undefined);
  return { language: word === undefined ? undefined : lookup(word), forced, sdh };
}
