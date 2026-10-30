import type { FastifyInstance } from 'fastify';
import { ApiError } from './api-error.js';
import { errorSchema } from './schemas.js';
import type { FolderWatcher } from './watcher.js';

const statusSchema = {
  type: 'object',
  required: ['enabled', 'mode', 'folders', 'pending', 'lastScanAt'],
  properties: {
    enabled: { type: 'boolean' },
    mode: { type: 'string', enum: ['events', 'poll'] },
    folders: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'libraryId', 'available'],
        properties: {
          path: { type: 'string' },
          libraryId: { type: 'string', nullable: true },
          available: { type: 'boolean' },
        },
      },
    },
    pending: { type: 'integer', description: 'Releases still being written or settling.' },
    lastScanAt: { type: 'string', nullable: true },
  },
} as const;

/** What the watcher is doing, and the manual "check now" for when a person knows better. */
export function registerWatchRoutes(api: FastifyInstance, watcher: FolderWatcher): void {
  api.get(
    '/api/watch',
    {
      schema: {
        summary: 'State of the watched folders',
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
          '409 `watch.not-configured` when no folder is watched.',
        response: {
          200: {
            type: 'object',
            required: ['submitted', 'pending', 'known'],
            properties: {
              submitted: { type: 'integer' },
              pending: { type: 'integer' },
              known: {
                type: 'integer',
                description: 'Releases an earlier scan already submitted.',
              },
            },
          },
          401: errorSchema,
          409: errorSchema,
        },
      },
    },
    async () => {
      if (!watcher.status().enabled) {
        throw new ApiError(409, 'watch.not-configured');
      }
      return await watcher.scan({ force: true });
    },
  );
}
