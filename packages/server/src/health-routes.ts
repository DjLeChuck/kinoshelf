import type { FastifyInstance } from 'fastify';
import type { Health } from './health.js';
import type { HealthReport } from './health-report.js';
import { errorSchema } from './schemas.js';

/** The verdict the navigation's badge shows; the Health page reads the details itself. */
const queueLane = {
  type: 'object',
  required: ['running', 'queued'],
  properties: { running: { type: 'integer' }, queued: { type: 'integer' } },
} as const;

const reportSchema = {
  type: 'object',
  required: ['problems', 'server', 'ffprobe', 'database', 'disks', 'queue', 'notify'],
  properties: {
    problems: {
      type: 'array',
      description:
        'What is wrong, errors then warnings. `area` is the card it belongs to, `code` is ' +
        'translated by the client (`web.health.problem.<code>`).',
      items: {
        type: 'object',
        required: ['area', 'code', 'severity'],
        properties: {
          area: { enum: ['ffprobe', 'database', 'disk', 'watch', 'media', 'webhooks'] },
          code: { type: 'string' },
          severity: { enum: ['error', 'warn'] },
          params: { type: 'object', additionalProperties: { type: 'string' } },
        },
      },
    },
    server: {
      type: 'object',
      required: ['version', 'uptimeSeconds', 'node', 'arch', 'configDir'],
      properties: {
        version: { type: 'string' },
        uptimeSeconds: { type: 'integer' },
        node: { type: 'string' },
        arch: { type: 'string' },
        configDir: { type: 'string' },
      },
    },
    ffprobe: {
      type: 'object',
      required: ['version'],
      properties: { version: { type: ['string', 'null'], description: '`null` when missing.' } },
    },
    database: {
      type: 'object',
      required: ['sizeBytes', 'journalEntries', 'cacheEntries', 'migrations'],
      properties: {
        sizeBytes: {
          type: ['integer', 'null'],
          description: 'The SQLite file, journal and cache.',
        },
        journalEntries: { type: 'integer' },
        cacheEntries: { type: 'integer', description: 'TMDB answers kept.' },
        migrations: {
          type: 'object',
          required: ['applied', 'last'],
          properties: {
            applied: { type: 'integer' },
            last: {
              type: ['object', 'null'],
              required: ['name', 'appliedAt'],
              properties: { name: { type: 'string' }, appliedAt: { type: 'string' } },
            },
          },
        },
      },
    },
    disks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['libraryId', 'name', 'path', 'totalBytes', 'freeBytes'],
        properties: {
          libraryId: { type: 'string' },
          name: { type: 'string' },
          path: { type: 'string' },
          totalBytes: { type: ['integer', 'null'] },
          freeBytes: { type: ['integer', 'null'] },
        },
      },
    },
    queue: {
      type: 'object',
      required: ['analyses', 'transfers', 'probes', 'completeness'],
      properties: {
        analyses: queueLane,
        transfers: queueLane,
        probes: { type: 'integer', description: 'Videos ffprobe has still to read.' },
        completeness: {
          type: 'integer',
          description: 'Shows whose missing episodes are to count.',
        },
      },
    },
    notify: {
      type: 'object',
      required: ['webhooks', 'plex', 'jellyfin', 'recent'],
      properties: {
        webhooks: { type: 'integer' },
        plex: { type: 'boolean' },
        jellyfin: { type: 'boolean' },
        recent: {
          type: 'array',
          description: 'Since the server started, newest first.',
          items: {
            type: 'object',
            required: ['at', 'kind', 'target', 'event', 'ok'],
            properties: {
              at: { type: 'string' },
              kind: { enum: ['webhook', 'plex', 'jellyfin'] },
              target: { type: 'string' },
              event: { type: 'string' },
              ok: { type: 'boolean' },
              attempts: { type: 'integer' },
              status: { type: 'integer' },
              error: { type: 'string' },
              failed: { type: 'integer' },
            },
          },
        },
      },
    },
  },
} as const;

export function registerHealthRoutes(
  api: FastifyInstance,
  health: Health,
  report: () => Promise<HealthReport>,
): void {
  api.get(
    '/api/health',
    {
      schema: {
        summary: 'How many things are wrong enough to be an error',
        description:
          'Light on purpose (no disk space, nothing slow): the web reads it at each `health` ' +
          'event for the badge of the System entry. Warnings are not counted.',
        response: {
          200: {
            type: 'object',
            required: ['errors'],
            properties: { errors: { type: 'integer', minimum: 0 } },
          },
          401: errorSchema,
        },
      },
    },
    async () => ({ errors: await health.check() }),
  );

  api.get(
    '/api/health/report',
    {
      schema: {
        summary: 'Everything the Health page shows',
        description:
          'Read when the page opens and at each `health` or `history` event. Slower than ' +
          '`GET /api/health`: disk space, `ffprobe`, the size of the database.',
        response: { 200: reportSchema, 401: errorSchema },
      },
    },
    async () => await report(),
  );
}
