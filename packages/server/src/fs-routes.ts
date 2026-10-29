import type { FastifyInstance } from 'fastify';
import { listFolder, MAX_ENTRIES, type FileFilter } from './browse.js';
import { errorSchema, folderListingSchema } from './schemas.js';

/**
 * Lets the UI browse the server's disk to fill a path setting: a browser cannot see it, and in
 * Docker only the mounted folders exist, which is exactly what a path must name. Not limited to
 * configured roots, which are what is being chosen; the API key already lets its holder submit any
 * path to `POST /api/jobs`, so this shows names and nothing more.
 */
export function registerFsRoutes(api: FastifyInstance): void {
  api.get<{ Querystring: { path: string; files?: FileFilter } }>(
    '/api/fs',
    {
      schema: {
        summary: 'List a folder of the server',
        description:
          'Sub-folders of an absolute path, for a path picker, and with `files=yaml` the YAML ' +
          'files too. Names only; hidden entries are left out and a symlink shows as its target. ' +
          `At most ${MAX_ENTRIES} entries (\`truncated\` says when more exist).`,
        querystring: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', minLength: 1 },
            files: { type: 'string', enum: ['yaml'] },
          },
        },
        response: {
          200: folderListingSchema,
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    (request) =>
      listFolder(request.query.path, {
        ...(request.query.files && { files: request.query.files }),
      }),
  );
}
