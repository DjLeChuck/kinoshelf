import type { FastifyInstance } from 'fastify';
import { ApiError } from './api-error.js';
import type { EventBus } from './events.js';
import { PlexTvError } from './notify/plex-auth.js';
import type { PlexSession } from './plex-session.js';
import { errorSchema } from './schemas.js';
import type { ConfigStore } from './settings.js';

export interface PlexContext {
  readonly session: PlexSession;
  readonly store: ConfigStore;
  readonly events: EventBus;
}

/** plex.tv's failures are its own: 502 for "down or odd", 409 when the account must sign in again. */
function asApiError(error: unknown): unknown {
  if (!(error instanceof PlexTvError)) {
    return error;
  }
  if (error.status === 404) {
    return new ApiError(404, 'plex.pin-unknown');
  }
  return error.rejected
    ? new ApiError(409, 'plex.not-signed-in')
    : new ApiError(502, 'plex.unreachable', { detail: error.message });
}

const plexGuard = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    throw asApiError(error);
  }
};

/** Signing in to Plex from the settings: a PIN claimed on plex.tv, then the account's servers. */
export function registerPlexRoutes(api: FastifyInstance, ctx: PlexContext): void {
  api.post(
    '/api/plex/auth',
    {
      schema: {
        summary: 'Start signing in to Plex',
        description:
          'Asks plex.tv for a PIN. Open `url` in a browser; the user signs in there, then ' +
          '`GET /api/plex/auth/{id}` tells when it is done.',
        response: {
          200: {
            type: 'object',
            required: ['id', 'url'],
            properties: { id: { type: 'integer' }, url: { type: 'string' } },
          },
          401: errorSchema,
          502: errorSchema,
        },
      },
    },
    async () => {
      const { id, authUrl } = await plexGuard(() => ctx.session.start());
      return { id, url: authUrl };
    },
  );

  api.get<{ Params: { id: number } }>(
    '/api/plex/auth/:id',
    {
      schema: {
        summary: 'Has the PIN been claimed?',
        description:
          'Called every couple of seconds while the user signs in on plex.tv. Once `done` is true ' +
          'the token is kept (and renewed from then on); a token typed in the settings is dropped, ' +
          'since the sign-in replaces it.',
        params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
        response: {
          200: { type: 'object', required: ['done'], properties: { done: { type: 'boolean' } } },
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
          502: errorSchema,
        },
      },
    },
    async (request) => {
      const done = await plexGuard(() => ctx.session.claim(request.params.id));
      if (done) {
        // Rebuilds the Plex client (a change of config does), and removes a token that would win.
        await ctx.store.update(() => [{ path: ['apiKey', 'plex'], value: undefined }]);
        ctx.events.emit('settings');
      }
      return { done };
    },
  );

  api.get(
    '/api/plex/servers',
    {
      schema: {
        summary: 'The Plex servers of the signed-in account',
        description:
          'To pick the address of the server instead of typing it. Local addresses come first, ' +
          'then remote ones, and relays (limited bandwidth) last.',
        response: {
          200: {
            type: 'object',
            required: ['servers'],
            properties: {
              servers: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'owned', 'connections'],
                  properties: {
                    name: { type: 'string' },
                    owned: { type: 'boolean' },
                    connections: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['uri', 'local', 'relay'],
                        properties: {
                          uri: { type: 'string' },
                          local: { type: 'boolean' },
                          relay: { type: 'boolean' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          401: errorSchema,
          409: errorSchema,
          502: errorSchema,
        },
      },
    },
    async () => {
      const servers = await plexGuard(() => ctx.session.servers());
      const rank = (c: { local: boolean; relay: boolean }): number =>
        c.relay ? 2 : c.local ? 0 : 1;
      return {
        servers: servers.map((server) => ({
          ...server,
          connections: [...server.connections].sort((a, b) => rank(a) - rank(b)),
        })),
      };
    },
  );

  api.delete(
    '/api/plex/auth',
    {
      schema: {
        summary: 'Sign out of Plex',
        description:
          'Forgets the token. The device stays in the account’s authorized devices, where it can ' +
          'be revoked on plex.tv.',
        response: { 204: { type: 'null' }, 401: errorSchema },
      },
    },
    async (_request, reply) => {
      ctx.session.signOut();
      await ctx.store.update(() => []);
      ctx.events.emit('settings');
      return reply.code(204).send();
    },
  );
}
