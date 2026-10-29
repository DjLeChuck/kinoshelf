export type Mode = 'copy' | 'hardlink' | 'move';
export type WebhookFormat = 'generic' | 'gotify' | 'ntfy' | 'discord';
export type WebhookEvent = 'transferred' | 'failed' | 'needs-review';

export interface PathMapping {
  from: string;
  to: string;
}

export interface Destination {
  readonly movies: string;
  readonly series: string;
}

/** What `GET /api/settings` returns. Secrets are only ever reported as set or not. */
export interface Settings {
  readonly tmdb: {
    readonly configured: boolean;
    readonly source: 'env' | 'file' | null;
    readonly language: string | null;
  };
  readonly locale: 'en' | 'fr' | null;
  readonly plex: {
    readonly url: string;
    readonly section: number | null;
    readonly tokenConfigured: boolean;
    readonly paths: readonly PathMapping[];
  } | null;
  readonly jellyfin: {
    readonly url: string;
    readonly tokenConfigured: boolean;
    readonly paths: readonly PathMapping[];
  } | null;
  readonly webhooks: readonly {
    readonly id: string;
    readonly target: string;
    readonly format: WebhookFormat;
    readonly on: readonly WebhookEvent[];
    readonly headerNames: readonly string[];
  }[];
  readonly watch: {
    readonly folders: readonly string[];
    readonly settleSeconds: number | null;
    readonly pollSeconds: number | null;
    readonly apply: boolean;
  } | null;
  readonly processing: {
    readonly profile: string | null;
    readonly mode: Mode | null;
    readonly threshold: number | null;
    readonly destination: string | Destination | null;
  };
  readonly apiKey: { readonly source: 'env' | 'database' | null };
  /** The profiles shipped with Kinoshelf. */
  readonly profiles: readonly { readonly id: string; readonly name: string }[];
}

export interface TestResult {
  readonly target: string;
  readonly kind: 'webhook' | 'plex' | 'jellyfin';
  readonly ok: boolean;
  readonly status?: number;
  readonly error?: string;
}

export const MODES: readonly Mode[] = ['copy', 'hardlink', 'move'];
export const WEBHOOK_FORMATS: readonly WebhookFormat[] = ['generic', 'gotify', 'ntfy', 'discord'];
export const WEBHOOK_EVENTS: readonly WebhookEvent[] = ['transferred', 'failed', 'needs-review'];

/** An emptied field removes the value: the API reads `null` as "unset", never an empty string. */
export const nullIfBlank = (text: string): string | null => {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * The threshold field: blank unsets it, a number from 0 to 100 sets it, anything else is
 * `undefined` so the form can refuse it before the server does.
 */
export function thresholdOf(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
}

export interface DestinationForm {
  separate: boolean;
  single: string;
  movies: string;
  series: string;
}

export function destinationForm(
  destination: Settings['processing']['destination'],
): DestinationForm {
  if (typeof destination === 'object' && destination !== null) {
    return { separate: true, single: '', movies: destination.movies, series: destination.series };
  }
  return { separate: false, single: destination ?? '', movies: '', series: '' };
}

/** One folder, or one per kind (Plex asks for separate libraries); `undefined` if incomplete. */
export function destinationOf(form: DestinationForm): string | Destination | null | undefined {
  if (!form.separate) {
    return nullIfBlank(form.single);
  }
  const movies = form.movies.trim();
  const series = form.series.trim();
  if (movies === '' && series === '') {
    return null;
  }
  return movies !== '' && series !== '' ? { movies, series } : undefined;
}

/** Rows left half empty are dropped: a mapping needs both sides. */
export const cleanMappings = (rows: readonly PathMapping[]): PathMapping[] =>
  rows
    .map(({ from, to }) => ({ from: from.trim(), to: to.trim() }))
    .filter(({ from, to }) => from !== '' && to !== '');

export interface WebhookRow {
  /** Present for a webhook that exists: its URL is a secret the API never returns. */
  readonly id?: string;
  readonly target?: string;
  url: string;
  format: WebhookFormat;
  on: WebhookEvent[];
}

export const webhookRows = (webhooks: Settings['webhooks']): WebhookRow[] =>
  webhooks.map((hook) => ({
    id: hook.id,
    target: hook.target,
    url: '',
    format: hook.format,
    on: [...hook.on],
  }));

/**
 * The whole list, as the API wants it: an existing webhook is named by its id (it keeps its URL
 * and headers), a new one carries its URL. A new row without a URL is not a webhook yet.
 */
export function webhooksPatch(rows: readonly WebhookRow[]) {
  return rows
    .filter((row) => row.id !== undefined || row.url.trim() !== '')
    .map((row) => ({
      ...(row.id !== undefined ? { id: row.id } : { url: row.url.trim() }),
      format: row.format,
      on: row.on,
    }));
}

/** The origin of a URL for display; what is not a URL is left as typed. */
export function isHttpUrl(text: string): boolean {
  try {
    const { protocol } = new URL(text);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** A mistake in the form itself, caught before the server is asked; its message is already text. */
export class FormError extends Error {
  override name = 'FormError';
}

/** The select's value for "my own file": no bundled profile has this id. */
export const CUSTOM_PROFILE = '__custom__';

export interface ProfileForm {
  /** `''` (the default), a bundled id, or `CUSTOM_PROFILE`. */
  choice: string;
  path: string;
}

/** A configured value that is not a bundled id is a path to the user's own file. */
export function profileForm(
  profile: string | null,
  bundled: readonly { readonly id: string }[],
): ProfileForm {
  if (profile === null) {
    return { choice: '', path: '' };
  }
  return bundled.some(({ id }) => id === profile)
    ? { choice: profile, path: '' }
    : { choice: CUSTOM_PROFILE, path: profile };
}

/** What to save; `undefined` when "my own file" is chosen but no path is given. */
export function profileOf(form: ProfileForm): string | null | undefined {
  if (form.choice === CUSTOM_PROFILE) {
    return nullIfBlank(form.path) ?? undefined;
  }
  return nullIfBlank(form.choice);
}

/** A whole number of seconds: blank unsets it, anything else is `undefined` (refused by the form). */
export function secondsOf(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

export interface WatchForm {
  enabled: boolean;
  folders: { path: string }[];
  settle: string;
  poll: string;
  apply: boolean;
}

export function watchForm(watch: Settings['watch']): WatchForm {
  return {
    enabled: watch !== null,
    folders: (watch ? [...watch.folders] : ['']).map((path) => ({ path })),
    settle: watch?.settleSeconds == null ? '' : String(watch.settleSeconds),
    poll: watch?.pollSeconds == null ? '' : String(watch.pollSeconds),
    apply: watch?.apply ?? false,
  };
}

/** What `PATCH /api/settings` takes for the form; `undefined` names the first thing refused. */
export function watchPatch(
  form: WatchForm,
): { watch: object | null } | { invalid: 'folders' | 'seconds' } {
  if (!form.enabled) {
    return { watch: null };
  }
  const folders = form.folders.map(({ path }) => path.trim()).filter((folder) => folder !== '');
  if (folders.length === 0 || folders.some((folder) => !folder.startsWith('/'))) {
    return { invalid: 'folders' };
  }
  const settleSeconds = secondsOf(form.settle);
  const pollSeconds = secondsOf(form.poll);
  if (settleSeconds === undefined || pollSeconds === undefined) {
    return { invalid: 'seconds' };
  }
  return { watch: { folders, settleSeconds, pollSeconds, apply: form.apply } };
}
