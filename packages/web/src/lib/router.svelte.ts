import { matchRoute } from './routes.js';

let path = $state(window.location.pathname);

window.addEventListener('popstate', () => {
  path = window.location.pathname;
});

export const router = {
  get path(): string {
    return path;
  },
  get route() {
    return matchRoute(path);
  },
  navigate(to: string, options: { replace?: boolean } = {}): void {
    if (to === path) {
      return;
    }
    window.history[options.replace ? 'replaceState' : 'pushState'](null, '', to);
    path = to;
    window.scrollTo(0, 0);
  },
};
