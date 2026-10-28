import { KinoshelfError } from '../errors.js';
import type { FilesystemRules } from '../types/profile.js';
import { finalizeSegment, sanitizeValue } from './sanitize.js';

/** A list renders as a range (first and last values), e.g. a double episode. */
export type TemplateValue = string | number | readonly number[];
export type TemplateVariables = Readonly<Record<string, TemplateValue | undefined>>;

export type TemplateToken =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'variable'; readonly name: string; readonly pad?: number };

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

/** Parses `{name}` / `{name:02}` variables; `\{` and `\}` are literal braces. */
export function parseTemplate(source: string): ParsedTemplate {
  const tokens: TemplateToken[] = [];
  let text = '';
  let i = 0;

  const flush = (): void => {
    if (text) {
      tokens.push({ kind: 'text', text });
      text = '';
    }
  };

  while (i < source.length) {
    const ch = source.charAt(i);

    if (ch === '\\') {
      const next = source.charAt(i + 1);
      if (next !== '{' && next !== '}') {
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
      tokens.push(
        width === undefined
          ? { kind: 'variable', name: match[1] }
          : { kind: 'variable', name: match[1], pad: Number(width) },
      );
      i = end + 1;
    } else if (ch === '}') {
      throw new KinoshelfError('template.unexpected-brace', { template: source, position: i });
    } else {
      text += ch;
      i += 1;
    }
  }
  flush();

  return { source, tokens };
}

export function templateVariables(template: ParsedTemplate): string[] {
  return template.tokens.flatMap((token) => (token.kind === 'variable' ? [token.name] : []));
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

/**
 * Renders a template into path segments (literal `/` in the template separates segments).
 * Substituted values are sanitized, so they can never add a segment. An empty template
 * renders no segment.
 */
export function renderTemplate(
  template: ParsedTemplate,
  variables: TemplateVariables,
  context: RenderContext,
): string[] {
  if (template.tokens.length === 0) {
    return [];
  }

  const segments: string[] = [];
  let current = '';

  for (const token of template.tokens) {
    if (token.kind === 'variable') {
      current += renderValue(token.name, variables[token.name], token.pad, context);
      continue;
    }
    const [head = '', ...rest] = token.text.split('/');
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
