import type { FastifyInstance } from 'fastify';
import { ApiError } from './api-error.js';
import { errorSchema } from './schemas.js';
import type { FolderWatcher } from './watcher.js';

const statusSchema = {
  type: 'object',
  required: ['enabled'],
  properties: { enabled: { type: 'boolean', description: 'At least one library is watched.' } },
} as const;

/** What the watcher is doing, and the manual "check now" for when a person knows better. */
export function registerWatchRoutes(api: FastifyInstance, watcher: FolderWatcher): void {
  api.get(
    '/api/watch',
    {
      schema: {
        summary: 'Whether any folder is watched',
        response: { 200: statusSchema, 401: errorSchema },
      },
    },
    () => ({ enabled: watcher.status().enabled }),
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
