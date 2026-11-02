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

/** `/history/<batch>`: a link to one batch, which no menu entry points at. */
export function batchIdOf(path: string): string | undefined {
  return /^\/history\/([^/]+)\/?$/.exec(path)?.[1];
}

/** The route a path belongs to; a trailing slash or a sub-path (`/history/abc`) still match. */
export function matchRoute(path: string): RouteDefinition | undefined {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return ROUTES.find(({ path: base }) => clean === base || clean.startsWith(`${base}/`));
}
