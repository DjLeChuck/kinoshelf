import type { MessageKey } from '@kinoshelf/i18n';

export type RouteId = 'home' | 'queue' | 'media' | 'libraries' | 'history' | 'settings';

export interface RouteDefinition {
  readonly id: RouteId;
  readonly path: string;
  readonly label: MessageKey;
  /** Not built yet: the page says what it will be, and the nav says it is coming. */
  readonly soon: boolean;
  /** Still in the nav while the welcome page has not been left: the rest has nothing to show yet. */
  readonly firstRun: boolean;
}

/** In the order of the navigation. */
export const ROUTES: readonly RouteDefinition[] = [
  { id: 'home', path: '/', label: 'web.nav.home', soon: false, firstRun: true },
  { id: 'queue', path: '/queue', label: 'web.nav.queue', soon: false, firstRun: false },
  { id: 'media', path: '/media', label: 'web.nav.media', soon: true, firstRun: false },
  { id: 'libraries', path: '/libraries', label: 'web.nav.libraries', soon: true, firstRun: false },
  { id: 'history', path: '/history', label: 'web.nav.history', soon: false, firstRun: false },
  { id: 'settings', path: '/settings', label: 'web.nav.settings', soon: false, firstRun: true },
];

/** The route a path belongs to; a trailing slash or a sub-path (`/history/abc`) still match. */
export function matchRoute(path: string): RouteDefinition | undefined {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return ROUTES.find(
    ({ path: base }) => clean === base || (base !== '/' && clean.startsWith(`${base}/`)),
  );
}
