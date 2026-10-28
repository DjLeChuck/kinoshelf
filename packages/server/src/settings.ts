import { createHash } from 'node:crypto';
import { editConfig, loadConfig, type Config, type ConfigEdit } from '@kinoshelf/core';
import { ApiError } from './api-error.js';
import { redactUrl } from './notify/paths.js';

type PathMapping = { from: string; to: string };

/** `null` removes a value, a value sets it, and leaving it out keeps what is there. */
type Nullable<T> = T | null;

export interface SettingsPatch {
  tmdb?: { apiKey?: Nullable<string>; language?: Nullable<string> };
  locale?: Nullable<'en' | 'fr'>;
  plex?: Nullable<{
    url: string;
    section?: Nullable<number>;
    token?: Nullable<string>;
    paths?: Nullable<PathMapping[]>;
  }>;
  jellyfin?: Nullable<{
    url: string;
    token?: Nullable<string>;
    paths?: Nullable<PathMapping[]>;
  }>;
  /** The whole list: a webhook left out is removed. */
  webhooks?: {
    /** Keeps the URL (and what is not given) of an existing webhook, whose URL is a secret. */
    id?: string;
    url?: string;
    format?: Nullable<'generic' | 'gotify' | 'ntfy' | 'discord'>;
    on?: Nullable<('transferred' | 'failed' | 'needs-review')[]>;
    headers?: Nullable<Record<string, string>>;
  }[];
  processing?: {
    profile?: Nullable<string>;
    mode?: Nullable<'copy' | 'hardlink' | 'move'>;
    threshold?: Nullable<number>;
    destination?: Nullable<string | { movies: string; series: string }>;
  };
}

/** A stable handle for a webhook, so the UI can name one without being told its secret URL. */
export const webhookId = (url: string): string =>
  createHash('sha256').update(url).digest('hex').slice(0, 12);

type Env = Readonly<Record<string, string | undefined>>;

/**
 * What the UI may know of the configuration. Secrets (API keys, tokens, the path of a webhook,
 * its headers) are never sent back: only whether they are set, so a page or a log of the
 * response cannot leak them.
 */
export function presentSettings(config: Config, env: Env): unknown {
  const { plex, jellyfin, webhooks = [] } = config.notify ?? {};
  const tmdbFromEnv = (env.TMDB_API_KEY ?? '').trim() !== '';
  return {
    tmdb: {
      configured: tmdbFromEnv || config.apiKey?.tmdb !== undefined,
      source: tmdbFromEnv ? 'env' : config.apiKey?.tmdb !== undefined ? 'file' : null,
      language: config.metadataLanguage ?? null,
    },
    locale: config.locale ?? null,
    plex: plex
      ? {
          url: plex.url,
          section: plex.section ?? null,
          tokenConfigured: config.apiKey?.plex !== undefined,
          paths: plex.paths ?? [],
        }
      : null,
    jellyfin: jellyfin
      ? {
          url: jellyfin.url,
          tokenConfigured: config.apiKey?.jellyfin !== undefined,
          paths: jellyfin.paths ?? [],
        }
      : null,
    webhooks: webhooks.map((webhook) => ({
      id: webhookId(webhook.url),
      target: redactUrl(webhook.url),
      format: webhook.format ?? 'generic',
      on: webhook.on ?? ['transferred', 'failed'],
      headerNames: Object.keys(webhook.headers ?? {}),
    })),
    processing: {
      profile: config.profile ?? null,
      mode: config.mode ?? null,
      threshold: config.threshold ?? null,
      destination: config.destination ?? null,
    },
  };
}

const set = (path: string[], value: unknown): ConfigEdit => ({ path, value: value ?? undefined });

/** `key: null` removes, `key: value` sets, an absent key keeps; applied over what is there. */
function merged(
  current: object | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const given = Object.entries(patch).filter(([, value]) => value !== undefined);
  const removed = new Set(given.filter(([, value]) => value === null).map(([key]) => key));
  return Object.fromEntries(
    Object.entries({ ...current, ...Object.fromEntries(given) }).filter(
      ([key]) => !removed.has(key),
    ),
  );
}

/** Turns a request into the edits of `config.yaml`, against the configuration as it is now. */
export function editsFor(patch: SettingsPatch, config: Config): ConfigEdit[] {
  const edits: ConfigEdit[] = [];
  const { tmdb, plex, jellyfin, webhooks, processing } = patch;

  if (tmdb?.apiKey !== undefined) {
    edits.push(set(['apiKey', 'tmdb'], tmdb.apiKey));
  }
  if (tmdb?.language !== undefined) {
    edits.push(set(['metadataLanguage'], tmdb.language));
  }
  if (patch.locale !== undefined) {
    edits.push(set(['locale'], patch.locale));
  }

  if (plex !== undefined) {
    if (plex === null) {
      edits.push(set(['notify', 'plex'], null), set(['apiKey', 'plex'], null));
    } else {
      const { token, ...rest } = plex;
      edits.push(set(['notify', 'plex'], merged(config.notify?.plex, rest)));
      if (token !== undefined) {
        edits.push(set(['apiKey', 'plex'], token));
      }
    }
  }
  if (jellyfin !== undefined) {
    if (jellyfin === null) {
      edits.push(set(['notify', 'jellyfin'], null), set(['apiKey', 'jellyfin'], null));
    } else {
      const { token, ...rest } = jellyfin;
      edits.push(set(['notify', 'jellyfin'], merged(config.notify?.jellyfin, rest)));
      if (token !== undefined) {
        edits.push(set(['apiKey', 'jellyfin'], token));
      }
    }
  }

  if (webhooks !== undefined) {
    const existing = config.notify?.webhooks ?? [];
    const next = webhooks.map(({ id, ...changes }) => {
      const base = id === undefined ? undefined : existing.find((w) => webhookId(w.url) === id);
      if (id !== undefined && !base) {
        throw new ApiError(404, 'settings.webhook-not-found', { id });
      }
      if (!base && changes.url === undefined) {
        throw new ApiError(400, 'settings.webhook-url-required');
      }
      return merged(base, changes);
    });
    edits.push(set(['notify', 'webhooks'], next.length > 0 ? next : null));
  }

  for (const [key, value] of Object.entries(processing ?? {})) {
    edits.push(set([key], value));
  }
  return edits;
}

/**
 * The configuration the server runs with, and the only way to change it. The object handed out
 * is the one every part of the server already holds: it is updated in place, so the processor
 * and the service see a change on their next call without being rebuilt. Writes are queued, since
 * two edits of one file read at once would lose one of them.
 */
export class ConfigStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly directory: string,
    readonly config: Config,
    private readonly onChange: (config: Config) => void,
  ) {}

  /**
   * `makeEdits` is given the file as it is on disk right now, not the copy this server started
   * with, so a hand edit made since is merged with, never overwritten. A hand edit is only
   * applied to the running server by the next change made here, or by a restart.
   */
  update(makeEdits: (current: Config) => readonly ConfigEdit[]): Promise<Config> {
    const run = this.queue.then(async () => {
      const edits = makeEdits(await loadConfig(this.directory));
      const next = await editConfig(this.directory, edits);
      const live = this.config as Record<string, unknown>;
      for (const key of Object.keys(live)) {
        // Config is read-only to everyone else; this store is the one place that replaces it.
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete live[key];
      }
      Object.assign(live, next);
      this.onChange(this.config);
      return this.config;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
