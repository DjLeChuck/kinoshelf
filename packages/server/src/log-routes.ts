import type { FastifyInstance } from 'fastify';
import { LOG_COMPONENTS, LOG_LEVELS, type LogLevel, type LogStore } from './logs.js';
import { errorSchema } from './schemas.js';

const entrySchema = {
  type: 'object',
  required: ['seq', 'time', 'level', 'component', 'message', 'job', 'data'],
  properties: {
    seq: { type: 'integer', description: 'Grows with each line.' },
    time: { type: 'string', format: 'date-time' },
    level: { enum: LOG_LEVELS },
    component: { enum: LOG_COMPONENTS },
    message: { type: 'string' },
    job: { type: ['string', 'null'], description: 'The job the line is about, if any.' },
    data: { type: 'object', additionalProperties: true, description: "The line's other fields." },
  },
} as const;

const pageSchema = {
  type: 'object',
  required: ['entries', 'newer', 'kept', 'since', 'fileBytes', 'level'],
  properties: {
    entries: { type: 'array', items: entrySchema, description: 'Newest first.' },
    newer: { type: 'integer', description: 'Matching lines newer than `after`; 0 without it.' },
    kept: { type: 'integer', description: 'Lines held in memory.' },
    since: { type: ['string', 'null'], format: 'date-time', description: 'The oldest of them.' },
    fileBytes: { type: 'integer', description: 'What the log files hold on the disk.' },
    level: { enum: LOG_LEVELS, description: 'The level the server logs at now.' },
  },
} as const;

export interface LogRouteDeps {
  readonly logs: LogStore;
  /** The level the server logs at: changing it needs no restart. */
  readonly level: { get(): LogLevel; set(level: LogLevel): void };
}

/** What the server logged, for the System page: a filtered list, the file, and the level. */
export function registerLogRoutes(api: FastifyInstance, { logs, level }: LogRouteDeps): void {
  api.get(
    '/api/logs',
    {
      schema: {
        summary: "The last lines of the server's log",
        description:
          'Read from memory (the last few thousand lines), newest first. Keys, tokens and webhook ' +
          'addresses are wiped before a line is kept. `after` is the `seq` of the newest line a ' +
          'client shows: `newer` then counts the matching lines it does not show yet.',
        querystring: {
          type: 'object',
          properties: {
            level: { enum: LOG_LEVELS, description: 'This level and above.' },
            component: { enum: LOG_COMPONENTS },
            q: { type: 'string', maxLength: 200 },
            minutes: { type: 'integer', minimum: 1, maximum: 10080 },
            limit: { type: 'integer', minimum: 1, maximum: 1000, default: 500 },
            after: { type: 'integer', minimum: 0 },
          },
          additionalProperties: false,
        },
        response: { 200: pageSchema, 400: errorSchema, 401: errorSchema },
      },
    },
    (request) => {
      const query = request.query as {
        level?: LogLevel;
        component?: string;
        q?: string;
        minutes?: number;
        limit?: number;
        after?: number;
      };
      return {
        ...logs.page({
          ...(query.level && { level: query.level }),
          ...(query.component && { component: query.component }),
          ...(query.q && { q: query.q }),
          ...(query.minutes && { minutes: query.minutes }),
          ...(query.after !== undefined && { after: query.after }),
          limit: query.limit ?? 500,
        }),
        level: level.get(),
      };
    },
  );

  api.get(
    '/api/logs/download',
    {
      schema: {
        summary: 'The log file',
        description:
          'Every line kept on the disk, oldest first, as JSON lines (`kinoshelf.log`). Wiped of ' +
          'secrets like the list.',
        response: {
          200: { type: 'string', description: 'application/x-ndjson' },
          401: errorSchema,
        },
      },
    },
    (_request, reply) => {
      void reply
        .type('application/x-ndjson; charset=utf-8')
        .header('content-disposition', 'attachment; filename="kinoshelf.log"')
        .header('cache-control', 'no-store');
      return logs.download();
    },
  );

  api.put(
    '/api/logs/level',
    {
      schema: {
        summary: 'Change the level the server logs at',
        description:
          'Takes effect at once and lasts until the server restarts (then `KINOSHELF_LOG_LEVEL`, or ' +
          '`info`, applies again): `debug` is for finding a problem, not for keeping.',
        body: {
          type: 'object',
          required: ['level'],
          properties: { level: { enum: LOG_LEVELS } },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            required: ['level'],
            properties: { level: { enum: LOG_LEVELS } },
          },
          400: errorSchema,
          401: errorSchema,
        },
      },
    },
    (request) => {
      const { level: next } = request.body as { level: LogLevel };
      level.set(next);
      return { level: level.get() };
    },
  );
}
