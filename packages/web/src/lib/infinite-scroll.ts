import type { Action } from 'svelte/action';

/**
 * Presses a "show more" button when it scrolls near the view, so a list keeps loading as it is
 * read. The button stays a real button (keyboard, screen readers, a browser with no
 * `IntersectionObserver`), and its own handler is the only path that loads. A caller re-creates the
 * button when the list grows (`{#key}`): an observer reports a change of visibility, so one still on
 * screen after a page would never ask for the next.
 */
export const loadWhenVisible: Action = (node) => {
  if (typeof IntersectionObserver === 'undefined') {
    return {};
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        node.click();
      }
    },
    { rootMargin: '400px 0px' },
  );
  observer.observe(node);
  return {
    destroy() {
      observer.disconnect();
    },
  };
};
