import swagger from '@fastify/swagger';
import type { Analysis } from '@kinoshelf/core';
import type { Database } from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { hasApiKey, isValidApiKey } from './auth.js';
import { JobStore, type Job } from './jobs.js';
import { createProcessor, type ProcessorDeps } from './processor.js';
import { JobRunner, type JobProcessor } from './runner.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The queue worker; tests await `jobs.idle()` instead of sleeping. */
    jobs: JobRunner;
  }
}

export interface AppOptions extends Omit<ProcessorDeps, 'database'> {
  readonly version: string;
  /** Already migrated (see `database.ts`). */
  readonly database: Database;
  readonly logger?: boolean;
  /** Replaces the real pipeline, for tests. */
  readonly processor?: JobProcessor;
}

const errorSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code'],
      properties: {
        code: { type: 'string' },
        params: { type: 'object', additionalProperties: { type: ['string', 'number'] } },
      },
    },
  },
} as const;

const healthResponse = {
  type: 'object',
  required: ['status', 'version'],
  properties: {
    status: { type: 'string', enum: ['ok'] },
    version: { type: 'string' },
  },
} as const;

const summarySchema = {
  type: 'object',
  nullable: true,
  required: ['compliant', 'to-rename', 'conflict', 'ambiguous', 'unrecognized'],
  properties: {
    compliant: { type: 'integer' },
    'to-rename': { type: 'integer' },
    conflict: { type: 'integer' },
    ambiguous: { type: 'integer' },
    unrecognized: { type: 'integer' },
  },
} as const;

const jobSchema = {
  type: 'object',
  required: ['id', 'path', 'status', 'createdAt', 'startedAt', 'finishedAt', 'error', 'summary'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    path: { type: 'string' },
    status: { type: 'string', enum: ['queued', 'running', 'done', 'failed'] },
    createdAt: { type: 'string', format: 'date-time' },
    startedAt: { type: 'string', format: 'date-time', nullable: true },
    finishedAt: { type: 'string', format: 'date-time', nullable: true },
    error: { ...errorSchema.properties.error, nullable: true },
    summary: summarySchema,
  },
} as const;

/** What a file became, without the plan internals: the queue endpoints expose the rest. */
const jobEntriesSchema = {
  type: 'array',
  items: {
    type: 'object',
    required: ['path', 'classification', 'destination'],
    properties: {
      path: { type: 'string' },
      classification: {
        type: 'string',
        enum: ['compliant', 'to-rename', 'conflict', 'ambiguous', 'unrecognized'],
      },
      destination: { type: 'string', nullable: true },
    },
  },
} as const;

function entriesOf(analysis: Analysis | undefined): unknown[] | null {
  return (
    analysis?.entries.map((entry) => ({
      path: entry.file.path,
      classification: entry.classification,
      destination:
        entry.item?.operations.find((op) => op.type === 'transfer' && op.role === 'main')
          ?.destination ?? null,
    })) ?? null
  );
}

/**
 * Builds the HTTP layer without listening, so tests can drive it with `inject`. Routes stay thin:
 * the logic lives in the core. Responses carry codes and parameters, never translated text.
 */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    // Fastify strips unknown fields by default; a client sending `dryRun` must hear it is not
    // supported rather than believe it was honored.
    ajv: { customOptions: { removeAdditional: false } },
  });
  const store = new JobStore(options.database);
  const runner = new JobRunner(store, options.processor ?? createProcessor(options), (error) => {
    app.log.error(error);
  });
  app.decorate('jobs', runner);
  app.addHook('onReady', () => {
    runner.start();
  });
  app.addHook('onClose', async () => {
    await runner.stop();
  });

  app.setErrorHandler(
    (error: Error & { validation?: unknown; statusCode?: number }, _req, reply) => {
      if (error.validation) {
        return reply
          .code(400)
          .send({ error: { code: 'request.invalid', params: { detail: error.message } } });
      }
      if (error.statusCode && error.statusCode < 500) {
        return reply
          .code(error.statusCode)
          .send({ error: { code: 'request.rejected', params: { detail: error.message } } });
      }
      app.log.error(error);
      return reply.code(500).send({ error: { code: 'internal.unexpected' } });
    },
  );

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Kinoshelf',
        description: 'Identify, rename and enrich a video library already on disk.',
        version: options.version,
      },
      components: {
        securitySchemes: {
          apiKey: {
            type: 'http',
            scheme: 'bearer',
            description: 'The key printed on first start.',
          },
        },
      },
      security: [{ apiKey: [] }],
    },
  });

  // Public on purpose: Docker's HEALTHCHECK and monitors call it without a key.
  app.get('/health', { schema: { security: [], response: { 200: healthResponse } } }, () => ({
    status: 'ok' as const,
    version: options.version,
  }));

  app.get('/api/openapi.json', { schema: { hide: true } }, () => app.swagger());

  await app.register((api, _options, done) => {
    api.addHook('onRequest', (request, reply, done) => {
      // Checked per request so `api-key create` takes effect without a restart.
      if (!hasApiKey(options.database)) {
        void reply.code(503).send({ error: { code: 'auth.not-configured' } });
        return;
      }
      const match = /^Bearer (.+)$/.exec(request.headers.authorization ?? '');
      if (!match?.[1] || !isValidApiKey(options.database, match[1])) {
        void reply
          .code(401)
          .header('www-authenticate', 'Bearer')
          .send({ error: { code: 'auth.unauthorized' } });
        return;
      }
      done();
    });

    api.post<{ Body: { path: string } }>(
      '/api/jobs',
      {
        schema: {
          summary: 'Submit a file or a folder to identify',
          description:
            'Queues the analysis (parse, match, plan) of an absolute path. Nothing is written to ' +
            'the disk; poll the job for its outcome.',
          body: {
            type: 'object',
            required: ['path'],
            additionalProperties: false,
            properties: { path: { type: 'string', pattern: '^/', description: 'Absolute path' } },
          },
          response: { 202: jobSchema, 400: errorSchema, 401: errorSchema, 503: errorSchema },
        },
      },
      (request, reply) => {
        const job = store.create(request.body.path);
        runner.kick();
        return reply.code(202).send(job);
      },
    );

    api.get<{ Querystring: { limit?: number } }>(
      '/api/jobs',
      {
        schema: {
          summary: 'List jobs, newest first',
          querystring: {
            type: 'object',
            properties: { limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
          },
          response: { 200: { type: 'array', items: jobSchema }, 401: errorSchema },
        },
      },
      (request) => store.list(request.query.limit ?? 50),
    );

    api.get<{ Params: { id: string } }>(
      '/api/jobs/:id',
      {
        schema: {
          summary: 'A job, with what became of each file once it is done',
          params: { type: 'object', properties: { id: { type: 'string' } } },
          response: {
            200: {
              ...jobSchema,
              required: [...jobSchema.required, 'entries'],
              properties: {
                ...jobSchema.properties,
                entries: { ...jobEntriesSchema, nullable: true },
              },
            },
            401: errorSchema,
            404: errorSchema,
          },
        },
      },
      (request, reply) => {
        const job: Job | undefined = store.get(request.params.id);
        if (!job) {
          return reply.code(404).send({ error: { code: 'job.not-found' } });
        }
        return { ...job, entries: entriesOf(store.analysis(job.id)) };
      },
    );

    done();
  });

  await app.ready();
  return app;
}
