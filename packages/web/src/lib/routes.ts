import type { MessageKey } from '@kinoshelf/i18n';

export type RouteId = 'queue' | 'media' | 'libraries' | 'history' | 'settings';

export interface RouteDefinition {
  readonly id: RouteId;
  readonly path: string;
  readonly label: MessageKey;
  /** Not built yet: the page says what it will be, and the nav says it is coming. */
  readonly soon: boolean;
}

/** In the order of the navigation. */
export const ROUTES: readonly RouteDefinition[] = [
  { id: 'queue', path: '/', label: 'web.nav.queue', soon: false },
  { id: 'media', path: '/media', label: 'web.nav.media', soon: true },
  { id: 'libraries', path: '/libraries', label: 'web.nav.libraries', soon: true },
  { id: 'history', path: '/history', label: 'web.nav.history', soon: false },
  { id: 'settings', path: '/settings', label: 'web.nav.settings', soon: false },
];

/** The route a path belongs to; a trailing slash or a sub-path (`/history/abc`) still match. */
export function matchRoute(path: string): RouteDefinition | undefined {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return ROUTES.find(
    ({ path: base }) => clean === base || (base !== '/' && clean.startsWith(`${base}/`)),
  );
}
