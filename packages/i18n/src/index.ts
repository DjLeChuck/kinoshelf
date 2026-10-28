import { en } from './en.js';
import { fr } from './fr.js';

export type Locale = 'en' | 'fr';
export type MessageKey = keyof typeof en;
export type Params = Readonly<Record<string, string | number>>;
export type Translate = (key: MessageKey, params?: Params) => string;

const catalogs: Record<Locale, Record<MessageKey, string>> = { en, fr };

export const isLocale = (value: string): value is Locale => value === 'en' || value === 'fr';

/** `--lang`, then the config file, then the environment (`LC_ALL`, `LC_MESSAGES`, `LANG`). */
export function detectLocale(
  flag: string | undefined,
  configured: Locale | undefined,
  env: Readonly<Record<string, string | undefined>>,
): Locale {
  if (flag !== undefined && isLocale(flag)) {
    return flag;
  }
  if (configured) {
    return configured;
  }
  const posix = env.LC_ALL || env.LC_MESSAGES || env.LANG || '';
  return posix.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function createTranslator(locale: Locale): Translate {
  const catalog = catalogs[locale];
  return (key, params = {}) =>
    catalog[key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      name in params ? String(params[name]) : placeholder,
    );
}

/** Message for an error code and its parameters, from the core or from the CLI. */
export function describeError(
  t: Translate,
  info: { readonly code: string; readonly params?: Params | undefined },
): string {
  const key = `error.${info.code}`;
  return key in en ? t(key as MessageKey, info.params) : t('error.unknown', { code: info.code });
}

export {
  CLI_ERROR_CODES,
  SERVER_ERROR_CODES,
  type CliErrorCode,
  type ServerErrorCode,
} from './codes.js';
export { en } from './en.js';
export { fr } from './fr.js';
