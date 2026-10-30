import type { Database } from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { generateApiKey, hasApiKey, isValidApiKey, setApiKey } from './auth.js';
import { errorSchema } from './schemas.js';
import {
  createSession,
  endSession,
  isValidSession,
  readCookie,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sessionCookie,
} from './sessions.js';

const sessionSchema = {
  type: 'object',
  required: ['authenticated'],
  properties: {
    authenticated: { type: 'boolean' },
    setup: {
      type: 'boolean',
      description:
        'No API key exists yet: the first launch can create one (`POST /api/setup/api-key`).',
    },
  },
} as const;

export const sessionToken = (request: FastifyRequest): string | undefined =>
  readCookie(request.headers.cookie, SESSION_COOKIE);

/**
 * `SameSite=Strict` already keeps the cookie off cross-site requests; this also refuses a write
 * whose `Origin` names another host, for the browsers and proxies that do not honor it.
 */
export function sameOrigin(request: FastifyRequest): boolean {
  const { origin } = request.headers;
  if (origin === undefined) {
    return true;
  }
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

/**
 * The UI signs in with the API key, so there is one secret to look after. The key is only
 * exchanged for a cookie: a script keeps using it directly as a bearer token.
 */
export function registerSessionRoutes(app: FastifyInstance, database: Database): void {
  app.get(
    '/api/session',
    {
      schema: {
        summary: 'Tell whether the browser has a valid session',
        security: [],
        response: { 200: sessionSchema },
      },
    },
    (request) => {
      const token = sessionToken(request);
      return {
        authenticated: token !== undefined && isValidSession(database, token),
        setup: !hasApiKey(database),
      };
    },
  );

  // Open to whoever reaches the server first, like the first-run screen of other self-hosted apps,
  // and only until a key exists. It opens no session: the key has to be used to sign in, which
  // proves it was written down. The check and the write run in one synchronous step.
  app.post(
    '/api/setup/api-key',
    {
      schema: {
        summary: 'Create the first API key',
        description:
          'Only while no key exists (409 `setup.already-done` after). The key is returned once ' +
          'and only its hash is kept.',
        security: [],
        response: {
          200: {
            type: 'object',
            required: ['apiKey'],
            properties: { apiKey: { type: 'string' } },
          },
          401: errorSchema,
          409: errorSchema,
        },
      },
    },
    (request, reply) => {
      if (!sameOrigin(request)) {
        return reply.code(401).send({ error: { code: 'auth.unauthorized' } });
      }
      if (hasApiKey(database)) {
        return reply.code(409).send({ error: { code: 'setup.already-done' } });
      }
      const apiKey = generateApiKey();
      setApiKey(database, apiKey);
      return reply.header('cache-control', 'no-store').send({ apiKey });
    },
  );

  app.post<{ Body: { apiKey: string } }>(
    '/api/session',
    {
      schema: {
        summary: 'Sign in to the web UI with the API key',
        security: [],
        body: {
          type: 'object',
          required: ['apiKey'],
          additionalProperties: false,
          properties: { apiKey: { type: 'string', minLength: 1 } },
        },
        response: { 200: sessionSchema, 401: errorSchema, 503: errorSchema },
      },
    },
    (request, reply) => {
      if (!hasApiKey(database)) {
        return reply.code(503).send({ error: { code: 'auth.not-configured' } });
      }
      if (!sameOrigin(request) || !isValidApiKey(database, request.body.apiKey)) {
        return reply.code(401).send({ error: { code: 'auth.unauthorized' } });
      }
      const token = createSession(database);
      void reply.header(
        'set-cookie',
        sessionCookie(token, { secure: request.protocol === 'https', maxAgeMs: SESSION_TTL_MS }),
      );
      return { authenticated: true };
    },
  );

  app.delete(
    '/api/session',
    {
      schema: {
        summary: 'Sign out of the web UI',
        security: [],
        response: { 204: { type: 'null' }, 401: errorSchema },
      },
    },
    (request, reply) => {
      if (!sameOrigin(request)) {
        return reply.code(401).send({ error: { code: 'auth.unauthorized' } });
      }
      const token = sessionToken(request);
      if (token !== undefined) {
        endSession(database, token);
      }
      return reply
        .header(
          'set-cookie',
          sessionCookie('', { secure: request.protocol === 'https', maxAgeMs: 0 }),
        )
        .code(204)
        .send();
    },
  );
}
