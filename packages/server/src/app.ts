import swagger from '@fastify/swagger';
import Fastify, { type FastifyInstance } from 'fastify';

export interface AppOptions {
  readonly version: string;
  readonly logger?: boolean;
}

const healthResponse = {
  type: 'object',
  required: ['status', 'version'],
  properties: {
    status: { type: 'string', enum: ['ok'] },
    version: { type: 'string' },
  },
} as const;

/**
 * Builds the HTTP layer without listening, so tests can drive it with `inject`. Routes stay thin:
 * the logic lives in the core. Responses carry codes and parameters, never translated text.
 */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Kinoshelf',
        description: 'Identify, rename and enrich a video library already on disk.',
        version: options.version,
      },
    },
  });

  // Public on purpose: Docker's HEALTHCHECK and monitors call it without a key.
  app.get('/health', { schema: { response: { 200: healthResponse } } }, () => ({
    status: 'ok' as const,
    version: options.version,
  }));

  app.get('/api/openapi.json', { schema: { hide: true } }, () => app.swagger());

  await app.ready();
  return app;
}
