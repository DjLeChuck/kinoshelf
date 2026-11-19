import { KinoshelfError } from '../errors.js';
import type { FilesystemRules, Profile } from '../types/profile.js';
import { finalizeSegment, sanitizeValue } from './sanitize.js';
import { OPTIONAL_VARIABLES } from './variables.js';

/** A list renders as a range (first and last values), e.g. a double episode. */
export type TemplateValue = string | number | readonly number[];
export type TemplateVariables = Readonly<Record<string, TemplateValue | undefined>>;

export type TemplateLeaf =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'variable'; readonly name: string; readonly pad?: number };

/**
 * A `[...]` run of the template. When it holds a variable that has no value the whole group, and
 * the separator before it, is left out (`[imdbid-{imdb}]`); otherwise it is written with its
 * brackets. A group with no variable is plain text. `\[` and `\]` are literal brackets.
 */
export type TemplateToken =
  TemplateLeaf | { readonly kind: 'group'; readonly tokens: readonly TemplateLeaf[] };

export interface ParsedTemplate {
  readonly source: string;
  readonly tokens: readonly TemplateToken[];
}

export interface RenderContext {
  readonly rules: FilesystemRules;
  /** Joins the first and last value of a list, e.g. `-e` gives `18-e19`. */
  readonly rangeSeparator: string;
  /** Bytes reserved at the end of the last segment (the extension added by the caller). */
  readonly reserveBytes?: number;
}

const VARIABLE = /^([A-Za-z][A-Za-z0-9]*)(?::0(\d+))?$/;

/**
 * Parses `{name}` / `{name:02}` variables and `[...]` groups; `\{`, `\}`, `\[` and `\]` are
 * literal characters.
 */
export function parseTemplate(source: string): ParsedTemplate {
  const tokens: TemplateToken[] = [];
  let group: TemplateLeaf[] | null = null;
  let text = '';
  let i = 0;

  const flush = (): void => {
    if (text) {
      (group ?? tokens).push({ kind: 'text', text });
      text = '';
    }
  };

  while (i < source.length) {
    const ch = source.charAt(i);

    if (ch === '\\') {
      const next = source.charAt(i + 1);
      if (next !== '{' && next !== '}' && next !== '[' && next !== ']') {
        throw new KinoshelfError('template.invalid-escape', { template: source, position: i });
      }
      text += next;
      i += 2;
    } else if (ch === '{') {
      const end = source.indexOf('}', i + 1);
      const body = end === -1 ? '' : source.slice(i + 1, end);
      const match = VARIABLE.exec(body);
      if (!match?.[1]) {
        throw new KinoshelfError('template.invalid-variable', { template: source, variable: body });
      }
      flush();
      const width = match[2];
      (group ?? tokens).push(
        width === undefined
          ? { kind: 'variable', name: match[1] }
          : { kind: 'variable', name: match[1], pad: Number(width) },
      );
      i = end + 1;
    } else if (ch === '}') {
      throw new KinoshelfError('template.unexpected-brace', { template: source, position: i });
    } else if (ch === '[') {
      if (group) {
        throw new KinoshelfError('template.unbalanced-bracket', { template: source, position: i });
      }
      flush();
      group = [];
      i += 1;
    } else if (ch === ']') {
      if (!group) {
        throw new KinoshelfError('template.unbalanced-bracket', { template: source, position: i });
      }
      flush();
      const closed: TemplateLeaf[] = group;
      group = null;
      if (closed.some((leaf) => leaf.kind === 'variable')) {
        tokens.push({ kind: 'group', tokens: closed });
      } else {
        // Nothing can be missing from it: plain text, brackets included.
        tokens.push({ kind: 'text', text: '[' });
        tokens.push(...closed);
        tokens.push({ kind: 'text', text: ']' });
      }
      i += 1;
    } else {
      text += ch;
      i += 1;
    }
  }
  if (group) {
    throw new KinoshelfError('template.unbalanced-bracket', {
      template: source,
      position: source.length,
    });
  }
  flush();

  return { source, tokens };
}

export function templateVariables(template: ParsedTemplate): string[] {
  return template.tokens.flatMap((token) =>
    token.kind === 'variable'
      ? [token.name]
      : token.kind === 'group'
        ? token.tokens.flatMap((leaf) => (leaf.kind === 'variable' ? [leaf.name] : []))
        : [],
  );
}

function renderValue(
  name: string,
  value: TemplateValue | undefined,
  pad: number | undefined,
  context: RenderContext,
): string {
  if (value === undefined) {
    throw new KinoshelfError('template.missing-variable', { variable: name });
  }

  if (typeof value === 'string') {
    if (pad !== undefined) {
      throw new KinoshelfError('template.pad-on-text', { variable: name });
    }
    return sanitizeValue(value, context.rules);
  }

  const format = (n: number): string =>
    pad === undefined ? String(n) : String(n).padStart(pad, '0');

  if (typeof value === 'number') {
    return format(value);
  }

  const first = value[0];
  const last = value[value.length - 1];
  if (first === undefined || last === undefined) {
    throw new KinoshelfError('template.missing-variable', { variable: name });
  }

  return first === last
    ? format(first)
    : `${format(first)}${context.rangeSeparator}${format(last)}`;
}

/** What may stand between a value and the one before it, and goes with it when it is left out. */
const SEPARATOR_AT_END = /[\s._-]+$/;

/** A piece of the name being built: literal text of the template, or a substituted value. */
interface Part {
  readonly text: string;
  readonly literal: boolean;
}

/** Whether a variable the template names may be left out when it has no value. */
function isOptional(name: string, value: TemplateValue | undefined): boolean {
  return (
    OPTIONAL_VARIABLES.includes(name) &&
    (value === undefined || (typeof value === 'string' && value === ''))
  );
}

/**
 * Renders a template into path segments (literal `/` in the template separates segments).
 * Substituted values are sanitized, so they can never add a segment. An empty template
 * renders no segment. A variable that has no value is an error, unless it is one of the optional
 * ones (`OPTIONAL_VARIABLES`): it is then left out with the separator before it, or with its whole
 * `[...]` group, so a name never keeps a double space or an empty bracket.
 */
export function renderTemplate(
  template: ParsedTemplate,
  variables: TemplateVariables,
  context: RenderContext,
): string[] {
  if (template.tokens.length === 0) {
    return [];
  }

  const parts: Part[] = [];
  const dropSeparator = (): void => {
    const last = parts[parts.length - 1];
    if (last?.literal !== true) {
      return;
    }
    const kept = last.text.replace(SEPARATOR_AT_END, '');
    parts.pop();
    if (kept) {
      parts.push({ text: kept, literal: true });
    }
  };
  const valueOf = (token: Extract<TemplateLeaf, { kind: 'variable' }>): Part => ({
    text: renderValue(token.name, variables[token.name], token.pad, context),
    literal: false,
  });

  for (const token of template.tokens) {
    if (token.kind === 'text') {
      parts.push({ text: token.text, literal: true });
    } else if (token.kind === 'variable') {
      if (isOptional(token.name, variables[token.name])) {
        dropSeparator();
      } else {
        parts.push(valueOf(token));
      }
    } else if (
      token.tokens.some(
        (leaf) => leaf.kind === 'variable' && isOptional(leaf.name, variables[leaf.name]),
      )
    ) {
      dropSeparator();
    } else {
      parts.push({ text: '[', literal: true });
      for (const leaf of token.tokens) {
        parts.push(leaf.kind === 'text' ? { text: leaf.text, literal: true } : valueOf(leaf));
      }
      parts.push({ text: ']', literal: true });
    }
  }

  const segments: string[] = [];
  let current = '';
  for (const part of parts) {
    if (!part.literal) {
      current += part.text;
      continue;
    }
    const [head = '', ...rest] = part.text.split('/');
    current += head;
    for (const piece of rest) {
      segments.push(current);
      current = piece;
    }
  }
  segments.push(current);

  const last = segments.length - 1;
  return segments.map((segment, index) => {
    const result = finalizeSegment(
      segment,
      context.rules,
      index === last ? (context.reserveBytes ?? 0) : 0,
    );
    if (!result) {
      throw new KinoshelfError('template.empty-segment', { template: template.source });
    }
    return result;
  });
}

/** A profile has a handful of templates, rendered once per file: parsed once. */
const parsedTemplates = new Map<string, ParsedTemplate>();
const MAX_PARSED_TEMPLATES = 256;

/**
 * Renders one of a profile's templates with the profile's own rules (forbidden characters, segment
 * length, episode range): the path segments it gives, `reserveBytes` kept free at the end.
 */
export function renderProfileTemplate(
  profile: Profile,
  template: string,
  variables: TemplateVariables,
  reserveBytes = 0,
): string[] {
  let parsed = parsedTemplates.get(template);
  if (!parsed) {
    parsed = parseTemplate(template);
    if (parsedTemplates.size >= MAX_PARSED_TEMPLATES) {
      parsedTemplates.clear();
    }
    parsedTemplates.set(template, parsed);
  }
  return renderTemplate(parsed, variables, {
    rules: profile.filesystem,
    rangeSeparator: profile.episodeRangeSeparator,
    reserveBytes,
  });
}
