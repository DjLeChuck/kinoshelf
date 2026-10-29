import { createTranslator, isLocale, type Locale, type Translate } from '@kinoshelf/i18n';

const KEY = 'kinoshelf.locale';

function initial(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved !== null && isLocale(saved)) {
      return saved;
    }
  } catch {
    // Storage can be blocked (private window): the browser's language is the fallback.
  }
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

const start = initial();
let current = $state<Locale>(start);
document.documentElement.lang = start;

/** Reads `current`, so whatever calls it in a template re-renders when the language changes. */
export const t: Translate = (key, params) => createTranslator(current)(key, params);

export const locale = {
  get value(): Locale {
    return current;
  },
  set(next: Locale): void {
    current = next;
    document.documentElement.lang = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Kept for this visit only.
    }
  },
};
