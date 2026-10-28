import swagger from '@fastify/swagger';
import { KinoshelfError, SqliteJournal, type Journal } from '@kinoshelf/core';
import type { Database } from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { ApiError } from './api-error.js';
import { hasApiKey, isValidApiKey } from './auth.js';
import { EntryStore } from './entries.js';
import { ExecutionStore } from './executions.js';
import { JobStore } from './jobs.js';
import { createProcessor, type ProcessorDeps } from './processor.js';
import { registerRoutes } from './routes.js';
import { JobRunner, type JobProcessor } from './runner.js';
import { healthSchema } from './schemas.js';
import { Service } from './service.js';

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
  /** Wraps or replaces the journal, for tests. */
  readonly journal?: (database: Database) => Journal;
}

/** The core's typed errors are the client's to fix or an upstream's fault, not a server bug. */
function statusOf(error: KinoshelfError): number {
  const { code } = error.info;
  return code.startsWith('tmdb.') ? 502 : code.startsWith('config.') ? 409 : 422;
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
  const entries = new EntryStore(options.database);
  const executions = new ExecutionStore(options.database);
  const jobs = new JobStore(options.database, entries, executions);
  const service = new Service({
    ...options,
    jobs,
    entries,
    executions,
    journal: options.journal?.(options.database) ?? new SqliteJournal(options.database),
  });
  const runner = new JobRunner(
    jobs,
    executions,
    options.processor ?? createProcessor(options),
    (execution) => service.run(execution),
    (error) => {
      app.log.error(error);
    },
  );
  app.decorate('jobs', runner);
  app.addHook('onReady', () => {
    runner.start();
  });
  app.addHook('onClose', async () => {
    await runner.stop();
  });

  app.setErrorHandler(
    (error: Error & { validation?: unknown; statusCode?: number }, _req, reply) => {
      if (error instanceof ApiError) {
        return reply
          .code(error.status)
          .send({ error: { code: error.code, ...(error.params && { params: error.params }) } });
      }
      if (error instanceof KinoshelfError) {
        return reply.code(statusOf(error)).send({ error: error.info });
      }
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
            description:
              'Set with KINOSHELF_API_KEY, or create one with `kinoshelf-server api-key create`.',
          },
        },
      },
      security: [{ apiKey: [] }],
    },
  });

  // Public on purpose: Docker's HEALTHCHECK and monitors call it without a key.
  app.get('/health', { schema: { security: [], response: { 200: healthSchema } } }, () => ({
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

    registerRoutes(api, { jobs, entries, executions, service, runner });
    done();
  });

  await app.ready();
  return app;
}
