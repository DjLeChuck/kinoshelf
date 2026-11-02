import type { MessageKey } from '@kinoshelf/i18n';

export type RouteId = 'libraries' | 'history' | 'settings';

export interface RouteDefinition {
  readonly id: RouteId;
  readonly path: string;
  readonly label: MessageKey;
  /** Still in the nav while the welcome page has not been left: the rest has nothing to show yet. */
  readonly firstRun: boolean;
}

/** In the order of the navigation. The welcome page lives at `/` and has no entry of its own. */
export const ROUTES: readonly RouteDefinition[] = [
  { id: 'libraries', path: '/libraries', label: 'web.nav.libraries', firstRun: false },
  { id: 'history', path: '/history', label: 'web.nav.history', firstRun: false },
  { id: 'settings', path: '/settings', label: 'web.nav.settings', firstRun: true },
];

/** `/history/<id>`: a link to one line of the history (a batch or a job), which no menu entry points at. */
export function historyIdOf(path: string): string | undefined {
  return /^\/history\/([^/]+)\/?$/.exec(path)?.[1];
}

/** The route a path belongs to; a trailing slash or a sub-path (`/history/abc`) still match. */
export function matchRoute(path: string): RouteDefinition | undefined {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  // Arrivals are the first tab of the libraries page.
  if (clean === '/arrivals') {
    return ROUTES.find(({ id }) => id === 'libraries');
  }
  return ROUTES.find(({ path: base }) => clean === base || clean.startsWith(`${base}/`));
}

/** A link target cut into what the router keeps apart: the path, and the `?query` (with its `?`). */
export function splitTarget(to: string): { path: string; search: string } {
  const at = to.indexOf('?');
  return at === -1 ? { path: to, search: '' } : { path: to.slice(0, at), search: to.slice(at) };
}

/** `search` with these parameters set, or dropped when `undefined`; others are kept. */
export function withParams(search: string, params: Record<string, string | undefined>): string {
  const next = new URLSearchParams(search);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  }
  const text = next.toString();
  return text === '' ? '' : `?${text}`;
}

/** A query value that is one of the allowed ones, else `undefined` (a stale or mistyped link). */
export function oneOf<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | undefined {
  return allowed.find((option) => option === value);
}

/** A comma-separated query value as a list (`?open=1,2`); empty or absent is no item. */
export function listOf(value: string | null): string[] {
  return (value ?? '').split(',').filter((part) => part !== '');
}

/** A list as a query value, `undefined` (the parameter is dropped) when it is empty. */
export function listParam(values: readonly (string | number)[]): string | undefined {
  return values.length === 0 ? undefined : values.join(',');
}

/** A path of this app, which the router can show: `//host/…` is another site, not a path. */
export const isInternal = (href: string): boolean => href.startsWith('/') && !href.startsWith('//');
