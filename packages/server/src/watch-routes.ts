import type { FastifyInstance } from 'fastify';
import { ApiError } from './api-error.js';
import { errorSchema } from './schemas.js';
import type { FolderWatcher } from './watcher.js';

const statusSchema = {
  type: 'object',
  required: [
    'enabled',
    'mode',
    'folders',
    'pending',
    'lastScanAt',
    'nextScanAt',
    'intervalSeconds',
  ],
  properties: {
    enabled: { type: 'boolean', description: 'At least one library is watched.' },
    mode: { type: 'string', enum: ['events', 'poll'] },
    folders: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'libraryId', 'available'],
        properties: {
          path: { type: 'string' },
          libraryId: { type: ['string', 'null'] },
          available: {
            type: 'boolean',
            description: 'False when the folder is missing or unreadable (an unmounted share).',
          },
        },
      },
    },
    pending: { type: 'integer', description: 'Releases still being written.' },
    lastScanAt: { type: ['string', 'null'], description: 'When the last scan ended.' },
    nextScanAt: {
      type: ['string', 'null'],
      description: 'When the periodic pass (safety net or poll) runs next.',
    },
    intervalSeconds: { type: ['integer', 'null'], description: 'Seconds between two such passes.' },
  },
} as const;

/** What the watcher is doing, and the manual "check now" for when a person knows better. */
export function registerWatchRoutes(api: FastifyInstance, watcher: FolderWatcher): void {
  api.get(
    '/api/watch',
    {
      schema: {
        summary: 'What the watcher is doing',
        response: { 200: statusSchema, 401: errorSchema },
      },
    },
    () => watcher.status(),
  );

  api.post(
    '/api/watch/scan',
    {
      schema: {
        summary: 'Look at the watched folders now',
        description:
          'Submits what is there without waiting for it to settle: whoever asks knows it is ' +
          'complete. A file still carrying a download suffix (`.part`, `.!qB`) is left alone. ' +
          'With `all`, starts over: every file is analysed again, except those a job is working ' +
          'on or that already wait in the arrivals (the libraries were emptied, say). ' +
          '409 `watch.not-configured` when no folder is watched.',
        body: {
          type: ['object', 'null'],
          properties: { all: { type: 'boolean' } },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            required: ['submitted', 'pending'],
            properties: {
              submitted: { type: 'integer' },
              pending: { type: 'integer', description: 'Releases still being written.' },
            },
          },
          401: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request) => {
      if (!watcher.status().enabled) {
        throw new ApiError(409, 'watch.not-configured');
      }
      const body = request.body as { all?: boolean } | null | undefined;
      return await watcher.scan({ force: true, all: body?.all === true });
    },
  );
}
