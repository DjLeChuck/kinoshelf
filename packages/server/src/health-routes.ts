import type { FastifyInstance } from 'fastify';
import type { Health } from './health.js';
import { errorSchema } from './schemas.js';

/** The verdict the navigation's badge shows; the Health page reads the details itself. */
export function registerHealthRoutes(api: FastifyInstance, health: Health): void {
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
}
