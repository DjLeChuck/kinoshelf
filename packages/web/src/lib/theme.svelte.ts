export type ThemePreference = 'dark' | 'light' | 'system';

const KEY = 'kinoshelf.theme';
const query = window.matchMedia('(prefers-color-scheme: dark)');

function initial(): ThemePreference {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
  } catch {
    // Storage can be blocked: follow the system.
  }
  return 'system';
}

let preference = $state<ThemePreference>(initial());
let systemDark = $state(query.matches);
query.addEventListener('change', (event) => {
  systemDark = event.matches;
});

/** What is shown: `system` resolves to the browser's own preference. */
const effective = $derived(preference === 'system' ? (systemDark ? 'dark' : 'light') : preference);

$effect.root(() => {
  $effect(() => {
    document.documentElement.dataset.theme = effective;
  });
});

export const theme = {
  get preference(): ThemePreference {
    return preference;
  },
  get effective(): 'dark' | 'light' {
    return effective;
  },
  set(next: ThemePreference): void {
    preference = next;
    try {
      if (next === 'system') {
        localStorage.removeItem(KEY);
      } else {
        localStorage.setItem(KEY, next);
      }
    } catch {
      // Kept for this visit only.
    }
  },
};
