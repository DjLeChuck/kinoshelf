const WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
};

const ROMAN: Readonly<Record<string, number>> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
};

const MARKER = '(?:vol(?:ume)?s?|tome|part(?:ie)?)\\.?';
// `Part 2`, `Volume II`, `Part Two`, `Tome 3`: the number follows the marker.
const AFTER = new RegExp(`\\b${MARKER}\\s*([\\p{L}\\d]{1,5})\\b`, 'giu');
// `2ème partie`, `1ère partie`: the French way puts it before.
const BEFORE = /\b(\d{1,2})\s*(?:[èe]re|[èe]me|re|er|e|nde?|nd)?\s+partie\b/giu;

function numberOf(token: string): number | undefined {
  if (/^\d{1,2}$/.test(token)) {
    return Number(token);
  }
  // A roman numeral is only one when written in capitals: `Part i` is not `Part I`.
  return ROMAN[token] ?? WORDS[token.toLowerCase()];
}

/**
 * The installment numbers a title names (`Kill Bill : Volume 2`, `The Godfather Part II`,
 * `Dune: Part Two`, `Reliques de la Mort : 2ème partie`): empty for a title that names none.
 */
export function installmentsOf(title: string): number[] {
  const found: number[] = [];
  for (const match of title.matchAll(AFTER)) {
    const number = numberOf(match[1] ?? '');
    if (number !== undefined) {
      found.push(number);
    }
  }
  for (const match of title.matchAll(BEFORE)) {
    found.push(Number(match[1]));
  }
  return found;
}
