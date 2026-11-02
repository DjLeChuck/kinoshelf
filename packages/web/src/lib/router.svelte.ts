import { matchRoute, splitTarget, withParams } from './routes.js';

let path = $state(window.location.pathname);
let search = $state(window.location.search);

window.addEventListener('popstate', () => {
  path = window.location.pathname;
  search = window.location.search;
});

export const router = {
  /** The path alone: the query is in `query`. */
  get path(): string {
    return path;
  },
  get query(): URLSearchParams {
    return new URLSearchParams(search);
  },
  get route() {
    return matchRoute(path);
  },
  navigate(to: string, options: { replace?: boolean; scroll?: boolean } = {}): void {
    const target = splitTarget(to);
    if (target.path === path && target.search === search) {
      return;
    }
    window.history[options.replace ? 'replaceState' : 'pushState'](null, '', to);
    path = target.path;
    search = target.search;
    if (options.scroll !== false) {
      window.scrollTo(0, 0);
    }
  },
  /** Sets or drops query parameters of the current page, in place (no history entry, no scroll). */
  setQuery(params: Record<string, string | undefined>): void {
    this.navigate(`${path}${withParams(search, params)}`, { replace: true, scroll: false });
  },
};
