export type Params = Readonly<Record<string, string | number>>;

/**
 * The one place that turns a catalog message and its parameters into text, so replacing it with a
 * full ICU implementation (`intl-messageformat`) later touches nothing else. The catalogs already
 * speak the part of ICU they need:
 *
 *   `{name}`                                         a parameter
 *   `{n, plural, =0 {…} one {…} other {…}}`          a plural, `#` standing for the number
 *
 * An exact `=N` wins over the category `Intl.PluralRules` picks for the language (in French
 * `one` covers 0 as well as 1: write `=0` when "no file" reads better than "0 file"). `other` is
 * required. A count that is not a number (`200+` when a list is cut short) takes `other` and is
 * printed as given. Anything else between braces is left as it is, `\{` included: no quoting,
 * no `select`, no number or date formats.
 */
export function formatMessage(template: string, params: Params, locale: string): string {
  return render(template, params, locale, undefined);
}

/** The parameters a message uses, sorted and without repeats: what both languages must share. */
export function placeholdersOf(template: string): string[] {
  const names = new Set<string>();
  collect(template, names);
  return [...names].sort();
}

interface Simple {
  readonly kind: 'simple';
  readonly name: string;
  readonly end: number;
}

interface Plural {
  readonly kind: 'plural';
  readonly name: string;
  readonly options: ReadonlyMap<string, string>;
  readonly end: number;
}

const SIMPLE = /^\{(\w+)\}/;
const PLURAL = /^\{(\w+)\s*,\s*plural\s*,/;
const SELECTOR = /^(=\d+|\w+)\s*\{/;

/** The argument opening at `start` (a `{`), or `undefined` when it is plain text or malformed. */
function parseArgument(text: string, start: number): Simple | Plural | undefined {
  const rest = text.slice(start);
  const simple = SIMPLE.exec(rest);
  if (simple?.[1] !== undefined) {
    return { kind: 'simple', name: simple[1], end: start + simple[0].length };
  }
  const plural = PLURAL.exec(rest);
  if (plural?.[1] === undefined) {
    return undefined;
  }
  const options = new Map<string, string>();
  let position = start + plural[0].length;
  for (;;) {
    while (/\s/.test(text[position] ?? '')) {
      position += 1;
    }
    if (text[position] === '}') {
      position += 1;
      break;
    }
    const selector = SELECTOR.exec(text.slice(position));
    if (selector?.[1] === undefined) {
      return undefined;
    }
    position += selector[0].length;
    const bodyStart = position;
    let depth = 1;
    while (position < text.length && depth > 0) {
      depth += text[position] === '{' ? 1 : text[position] === '}' ? -1 : 0;
      position += 1;
    }
    if (depth !== 0) {
      return undefined;
    }
    options.set(selector[1], text.slice(bodyStart, position - 1));
  }
  return options.has('other')
    ? { kind: 'plural', name: plural[1], options, end: position }
    : undefined;
}

const rules = new Map<string, Intl.PluralRules>();

function categoryOf(locale: string, count: number): string {
  let found = rules.get(locale);
  if (!found) {
    found = new Intl.PluralRules(locale);
    rules.set(locale, found);
  }
  return found.select(count);
}

/** `pound` is what `#` stands for, inside the branch of a plural. */
function render(text: string, params: Params, locale: string, pound: string | undefined): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    const argument = char === '{' ? parseArgument(text, index) : undefined;
    if (!argument) {
      out += char === '#' && pound !== undefined ? pound : char;
      index += 1;
      continue;
    }
    const value = params[argument.name];
    if (value === undefined) {
      // No value: show the placeholder, which is how a missing parameter is spotted.
      out += text.slice(index, argument.end);
    } else if (argument.kind === 'simple') {
      out += String(value);
    } else {
      const count = typeof value === 'number' ? value : value.trim() === '' ? NaN : Number(value);
      const finite = Number.isFinite(count);
      const branch =
        (finite ? argument.options.get(`=${count}`) : undefined) ??
        (finite ? argument.options.get(categoryOf(locale, count)) : undefined) ??
        argument.options.get('other') ??
        '';
      out += render(branch, params, locale, String(value));
    }
    index = argument.end;
  }
  return out;
}

function collect(text: string, names: Set<string>): void {
  for (let index = 0; index < text.length; index += 1) {
    const argument = text.charAt(index) === '{' ? parseArgument(text, index) : undefined;
    if (!argument) {
      continue;
    }
    names.add(argument.name);
    if (argument.kind === 'plural') {
      for (const branch of argument.options.values()) {
        collect(branch, names);
      }
    }
    index = argument.end - 1;
  }
}
