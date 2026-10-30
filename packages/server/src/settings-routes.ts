import { listBundledProfiles, loadBundledProfile } from '@kinoshelf/core';
import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { ApiError } from './api-error.js';
import { generateApiKey, hasApiKey, setApiKey } from './auth.js';
import type { EventBus } from './events.js';
import { errorSchema, settingsPatchSchema, settingsSchema } from './schemas.js';
import type { Service } from './service.js';
import { createSession, SESSION_TTL_MS, sessionCookie } from './sessions.js';
import { sessionToken } from './session-routes.js';
import { editsFor, presentSettings, type ConfigStore, type SettingsPatch } from './settings.js';

export interface SettingsContext {
  readonly store: ConfigStore;
  readonly database: Database;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly events: EventBus;
  readonly service: Service;
}

/** The profiles shipped with Kinoshelf, for the UI to offer them instead of asking for a name. */
async function bundledProfiles(): Promise<{ id: string; name: string }[]> {
  return Promise.all(
    (await listBundledProfiles()).map(async (id) => ({
      id,
      name: (await loadBundledProfile(id)).name,
    })),
  );
}

const apiKeySource = (ctx: SettingsContext): 'env' | 'database' | null =>
  (ctx.env.KINOSHELF_API_KEY ?? '') !== '' ? 'env' : hasApiKey(ctx.database) ? 'database' : null;

export function registerSettingsRoutes(api: FastifyInstance, ctx: SettingsContext): void {
  const present = async (): Promise<unknown> => ({
    ...(presentSettings(ctx.store.config, ctx.env) as object),
    apiKey: { source: apiKeySource(ctx) },
    profiles: await bundledProfiles(),
  });

  api.get(
    '/api/settings',
    {
      schema: {
        summary: 'The settings the UI edits',
        description:
          'Secrets are never returned: a key or a token is reported as set or not, and a ' +
          'webhook by its origin. They live in `config.yaml`, which this edits in place (comments ' +
          'are kept).',
        response: { 200: settingsSchema, 401: errorSchema },
      },
    },
    present,
  );

  api.patch<{ Body: SettingsPatch }>(
    '/api/settings',
    {
      schema: {
        summary: 'Change settings',
        description:
          'Only what is sent changes: `null` removes a value, a value sets it. `webhooks` is the ' +
          'whole list; name an existing one by its `id` to keep its URL. Applied at once, without ' +
          'a restart. An invalid result is refused (409 `config.invalid`) and nothing is written.',
        body: settingsPatchSchema,
        response: {
          200: settingsSchema,
          400: errorSchema,
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request) => {
      if (request.body.tmdb?.apiKey !== undefined && (ctx.env.TMDB_API_KEY ?? '').trim() !== '') {
        // The variable wins at every start and at every lookup: a key saved here would be dead.
        throw new ApiError(409, 'settings.tmdb-key-from-env');
      }
      if (Object.keys(request.body).length > 0) {
        await ctx.store.update((current) => editsFor(request.body, current));
        ctx.events.emit('settings');
      }
      return await present();
    },
  );

  api.post(
    '/api/settings/tmdb/test',
    {
      schema: {
        summary: 'Check that the TMDB key works',
        description: 'Runs a search with the key in use (`tmdb.invalid-key` if TMDB refuses it).',
        response: {
          200: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
          401: errorSchema,
          502: errorSchema,
          409: errorSchema,
        },
      },
    },
    async () => {
      await ctx.service.search({ query: 'matrix', kind: 'movie' });
      return { ok: true };
    },
  );

  api.post(
    '/api/settings/api-key',
    {
      schema: {
        summary: 'Replace the API key',
        description:
          'The new key is returned once and cannot be read again. Scripts using the old one ' +
          'stop working at once; a browser session stays open.',
        response: {
          200: { type: 'object', required: ['apiKey'], properties: { apiKey: { type: 'string' } } },
          401: errorSchema,
          409: errorSchema,
        },
      },
    },
    (request, reply) => {
      if (apiKeySource(ctx) === 'env') {
        // The variable would put the old key back at the next start.
        throw new ApiError(409, 'settings.api-key-from-env');
      }
      const apiKey = generateApiKey();
      setApiKey(ctx.database, apiKey);
      // Replacing the key ends every session, this one included: reopen it for the browser that
      // asked, which just proved it holds one.
      if (sessionToken(request) !== undefined) {
        void reply.header(
          'set-cookie',
          sessionCookie(createSession(ctx.database), {
            secure: request.protocol === 'https',
            maxAgeMs: SESSION_TTL_MS,
          }),
        );
      }
      return { apiKey };
    },
  );
}
