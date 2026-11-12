import type { FastifyInstance } from 'fastify';
import { TMDB_CALL_KINDS, TMDB_OUTCOMES } from '@kinoshelf/provider-tmdb';
import { errorSchema } from './schemas.js';
import { USAGE_PERIODS, type TmdbUsage, type UsagePeriod } from './tmdb-usage.js';

const countsProperties = {
  network: { type: 'integer', description: 'Requests sent to TMDB that came back (a 404 too).' },
  cache: { type: 'integer', description: 'Calls answered by the cache: nothing was sent.' },
  rateLimited: { type: 'integer', description: 'Requests TMDB answered with a 429.' },
  serverError: { type: 'integer', description: 'Requests TMDB answered with a 5xx.' },
  unreachable: { type: 'integer', description: 'Requests that never got an answer.' },
  refused: { type: 'integer', description: 'Requests refused otherwise (a wrong key, a 4xx).' },
  latencyMs: {
    type: ['integer', 'null'],
    description: 'Median time of the requests that came back, to within 12 %.',
  },
} as const;
const countsRequired = [
  'network',
  'cache',
  'rateLimited',
  'serverError',
  'unreachable',
  'refused',
  'latencyMs',
] as const;

const reportSchema = {
  type: 'object',
  required: ['period', 'totals', 'slots', 'kinds', 'recentErrors', 'since', 'cache'],
  properties: {
    period: { enum: USAGE_PERIODS },
    totals: { type: 'object', required: countsRequired, properties: countsProperties },
    slots: {
      type: 'array',
      description: 'One per hour (24 h) or per UTC day (7 d, 30 d), oldest first, empty ones too.',
      items: {
        type: 'object',
        required: ['start', 'network', 'cache', 'errors'],
        properties: {
          start: { type: 'string', format: 'date-time' },
          network: { type: 'integer' },
          cache: { type: 'integer' },
          errors: { type: 'integer' },
        },
      },
    },
    kinds: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', ...countsRequired],
        properties: { kind: { enum: TMDB_CALL_KINDS }, ...countsProperties },
      },
    },
    recentErrors: {
      type: 'array',
      description: 'Since the server started, newest first.',
      items: {
        type: 'object',
        required: ['at', 'kind', 'outcome', 'status', 'path'],
        properties: {
          at: { type: 'string', format: 'date-time' },
          kind: { enum: TMDB_CALL_KINDS },
          outcome: { enum: TMDB_OUTCOMES.filter((o) => o !== 'cache' && o !== 'network') },
          status: { type: ['integer', 'null'] },
          path: { type: 'string' },
        },
      },
    },
    since: { type: 'string', format: 'date-time', description: 'When the server started.' },
    cache: {
      type: 'object',
      required: ['entries', 'bytes'],
      properties: { entries: { type: 'integer' }, bytes: { type: 'integer' } },
    },
  },
} as const;

/** What Kinoshelf asked TMDB, for the System page, and the cache it keeps. */
export function registerTmdbRoutes(api: FastifyInstance, usage: TmdbUsage): void {
  api.get(
    '/api/tmdb/usage',
    {
      schema: {
        summary: 'What Kinoshelf sent to TMDB',
        description:
          'Counted by Kinoshelf itself (TMDB reports no quota): requests sent, calls answered by ' +
          'the cache, and failures, per kind of call, over 24 hours, 7 days or 30 days.',
        querystring: {
          type: 'object',
          properties: { period: { enum: USAGE_PERIODS, default: '24h' } },
          additionalProperties: false,
        },
        response: { 200: reportSchema, 400: errorSchema, 401: errorSchema },
      },
    },
    (request) => usage.report((request.query as { period?: UsagePeriod }).period ?? '24h'),
  );

  api.delete(
    '/api/tmdb/cache',
    {
      schema: {
        summary: 'Forget the cached TMDB answers',
        description: 'The next analyses ask TMDB again. Nothing else is touched.',
        response: {
          200: {
            type: 'object',
            required: ['removed'],
            properties: { removed: { type: 'integer' } },
          },
          401: errorSchema,
        },
      },
    },
    () => ({ removed: usage.clearCache() }),
  );
}
