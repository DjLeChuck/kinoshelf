import type { FastifyInstance } from 'fastify';
import {
  DIAGNOSTIC_LOG_LINES,
  buildDiagnostic,
  diagnosticConfig,
  diagnosticFilename,
  diagnosticSummary,
  type DiagnosticDeps,
} from './diagnostic.js';
import { errorSchema } from './schemas.js';

/** What a person attaches to a bug report: shown first (`GET /api/diagnostic`), then downloaded. */
export function registerDiagnosticRoutes(api: FastifyInstance, deps: DiagnosticDeps): void {
  api.get(
    '/api/diagnostic',
    {
      schema: {
        summary: 'What the diagnostic archive says of this install',
        description:
          'The versions to copy into a bug report and the configuration as the archive carries ' +
          'it: secrets are only said to be set, never shown.',
        response: {
          200: {
            type: 'object',
            required: ['summary', 'config', 'logLines'],
            properties: {
              summary: {
                type: 'object',
                required: ['kinoshelf', 'node', 'platform', 'ffprobe', 'uptimeSeconds', 'locale'],
                properties: {
                  kinoshelf: { type: 'string' },
                  node: { type: 'string' },
                  platform: { type: 'string' },
                  ffprobe: { type: ['string', 'null'] },
                  uptimeSeconds: { type: 'integer' },
                  locale: { type: ['string', 'null'] },
                },
              },
              config: { type: 'object', additionalProperties: true },
              logLines: { type: 'integer', description: 'The newest lines the archive holds.' },
            },
          },
          401: errorSchema,
        },
      },
    },
    async () => ({
      summary: await diagnosticSummary(deps),
      config: diagnosticConfig(deps.config(), deps.env),
      logLines: DIAGNOSTIC_LOG_LINES,
    }),
  );

  api.get(
    '/api/diagnostic/archive',
    {
      schema: {
        summary: 'The diagnostic archive',
        description:
          'A zip made on the spot: `summary.json`, `config.json` (secrets left out), ' +
          '`health.json`, `tmdb-usage.json` (7 days) and the newest log lines (`logs.ndjson`, ' +
          'wiped of secrets).',
        response: { 200: { type: 'string', description: 'application/zip' }, 401: errorSchema },
      },
    },
    async (_request, reply) => {
      const archive = await buildDiagnostic(deps);
      void reply
        .type('application/zip')
        .header(
          'content-disposition',
          `attachment; filename="${diagnosticFilename((deps.now ?? ((): Date => new Date()))())}"`,
        )
        .header('cache-control', 'no-store');
      return archive;
    },
  );
}
