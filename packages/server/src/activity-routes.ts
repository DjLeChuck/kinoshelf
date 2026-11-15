import type { FastifyInstance } from 'fastify';
import type { Activity } from './activity.js';
import { errorSchema } from './schemas.js';

const taskSchema = {
  type: 'object',
  required: ['id', 'kind', 'code', 'params', 'status', 'done', 'total', 'current', 'href', 'error'],
  properties: {
    id: { type: 'string' },
    kind: { type: 'string' },
    code: { type: 'string', description: 'Translated by the client (`web.activity.task.<code>`).' },
    params: { type: 'object', additionalProperties: { type: ['string', 'number'] } },
    status: { enum: ['running', 'done', 'failed'] },
    done: { type: ['integer', 'null'], description: '`null`: the task cannot tell how far it is.' },
    total: { type: ['integer', 'null'] },
    current: { type: ['string', 'null'] },
    href: { type: ['string', 'null'], description: 'Where the web follows the task.' },
    error: {
      type: ['object', 'null'],
      required: ['code'],
      properties: {
        code: { type: 'string' },
        params: { type: 'object', additionalProperties: { type: ['string', 'number'] } },
      },
    },
  },
} as const;

export function registerActivityRoutes(api: FastifyInstance, activity: Activity): void {
  api.get(
    '/api/activity',
    {
      schema: {
        summary: 'What the server is doing in the background',
        description:
          'Running tasks, then those that ended a moment ago (done for a few seconds, failed ' +
          'for ten minutes). Read by the activity panel at each `progress`, `jobs` and `history` event.',
        response: {
          200: {
            type: 'object',
            required: ['tasks'],
            properties: { tasks: { type: 'array', items: taskSchema } },
          },
          401: errorSchema,
        },
      },
    },
    () => ({ tasks: activity.list() }),
  );
}
